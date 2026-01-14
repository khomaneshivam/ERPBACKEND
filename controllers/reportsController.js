import { db } from "../config/db.js";

/* ============================================================================ 
   Reports Controller 
   - Payments Hidden in Monthly Report
   - Robust delete_status checks (Safety against NULLs)
   - Full Summaries & Categorization restored
============================================================================ */

const respond = (res, data = null, msg = "Success", status = 200) =>
  res.status(status).json({ msg, data });

/* ============================================================================ 
   GET REPORT META
============================================================================ */
export const getReportMeta = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const [customers] = await db.query(
      `SELECT id, name FROM parties 
       WHERE party_type='Customer' AND company_id = ? 
       AND (delete_status IS NULL OR delete_status = 0)`,
      [companyId]
    );

    const [suppliers] = await db.query(
      `SELECT id, name FROM parties 
       WHERE party_type='Supplier' AND company_id = ? 
       AND (delete_status IS NULL OR delete_status = 0)`,
      [companyId]
    );

    const [expenseTypes] = await db.query(
      `SELECT DISTINCT IFNULL(expense_category,'Uncategorized') AS category
       FROM expenses
       WHERE company_id = ? 
       AND (delete_status IS NULL OR delete_status = 0)`,
      [companyId]
    );

    const [banks] = await db.query(
      `SELECT id, bank_name, account_no 
       FROM banks 
       WHERE company_id = ? 
       AND (delete_status IS NULL OR delete_status = 0)`,
      [companyId]
    );

    respond(res, {
      customers,
      suppliers,
      banks,
      expenseTypes: expenseTypes.map((r) => r.category),
    });

  } catch (err) {
    console.error("getReportMeta ERR:", err);
    res.status(500).json({ msg: "Server error" });
  }
};

/* ============================================================================ 
   GET MONTHLY REPORT
============================================================================ */
export const getMonthlyReport = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const {
      month,
      startDate,
      endDate,
      type = "all",
      customer,
      supplier,
      expenseType,
      page = 0,
      limit = 20,
    } = req.body || {};

    const pageNum = Number(page) || 0;
    const pageLimit = Number(limit) || 20;
    const fetchAll = pageLimit === -1;
    const offset = fetchAll ? 0 : pageNum * pageLimit;

    // --- 1. Base Filters (Respecting Soft Delete) ---

    const cashWhere = [
      "cl.company_id = ?",
      "(cl.delete_status IS NULL OR cl.delete_status = 0)",
      "cl.reference_type NOT IN ('CustomerPayment','SupplierPayment')"
    ];

    const bankWhere = [
      "bl.company_id = ?",
      "(bl.delete_status IS NULL OR bl.delete_status = 0)",
      "bl.module NOT IN ('CustomerPayment','SupplierPayment')"
    ];

    const creditWhere = [
      "clg.company_id = ?",
      "(clg.delete_status IS NULL OR clg.delete_status = 0)"
    ];

    const cashParams = [companyId];
    const bankParams = [companyId];
    const creditParams = [companyId];

    // --- 2. Date Filters ---
    if (startDate && endDate) {
      cashWhere.push("DATE(cl.txn_date) BETWEEN ? AND ?");
      bankWhere.push("DATE(bl.txn_date) BETWEEN ? AND ?");
      creditWhere.push("DATE(clg.txn_date) BETWEEN ? AND ?");

      cashParams.push(startDate, endDate);
      bankParams.push(startDate, endDate);
      creditParams.push(startDate, endDate);

    } else if (month) {
      cashWhere.push("DATE_FORMAT(cl.txn_date,'%Y-%m') = ?");
      bankWhere.push("DATE_FORMAT(bl.txn_date,'%Y-%m') = ?");
      creditWhere.push("DATE_FORMAT(clg.txn_date,'%Y-%m') = ?");

      cashParams.push(month);
      bankParams.push(month);
      creditParams.push(month);
    }

    // --- 3. Type/Entity Filters ---
    if (type === "sales") {
      cashWhere.push("cl.reference_type IN ('Sale')");
      bankWhere.push("bl.module IN ('Sales')");
      // Credit Ledger handles sales via 'CustomerCredit'? 
      // Adjust based on your schema. Usually credit_ledger.reference_type = 'Sale'
      creditWhere.push("clg.reference_type = 'Sale'");

      if (customer) {
        cashWhere.push("cl.note LIKE ?");
        bankWhere.push("bl.description LIKE ?");
        creditWhere.push("clg.note LIKE ?"); // or join parties
        const like = `%${customer}%`;
        cashParams.push(like);
        bankParams.push(like);
        creditParams.push(like);
      }

    } else if (type === "purchases") {
      cashWhere.push("cl.reference_type IN ('Purchase')");
      bankWhere.push("bl.module IN ('Purchase')");
      creditWhere.push("clg.reference_type = 'Purchase'");

      if (supplier) {
        cashWhere.push("cl.note LIKE ?");
        bankWhere.push("bl.description LIKE ?");
        creditWhere.push("clg.note LIKE ?");
        const like = `%${supplier}%`;
        cashParams.push(like);
        bankParams.push(like);
        creditParams.push(like);
      }

    } else if (type === "expenses") {
      cashWhere.push("cl.reference_type = 'Expense'");
      bankWhere.push("bl.module = 'Expense'");
      creditWhere.push("clg.reference_type = 'Expense'");
      
      if (expenseType) {
        // This requires the JOINs below to work for filtering
        // For simplicity, we often filter in JS or need complex SQL injection here
        // Assuming expenseType filtering happens on the 'category' column in the joined table
      }
    }

    // --- 4. SQL Construction (With Joins for Delete Status on Parents) ---

    // Cash SQL
    const cashSql = `
      SELECT
        cl.id,
        DATE_FORMAT(cl.txn_date,'%d-%m-%Y') AS date,
        cl.txn_date AS rawDate,
        cl.reference_type AS type,
        cl.amount AS amount,
        cl.amount AS total,
        cl.note AS party,
        'Cash' AS paymentMode,
        cl.type AS flowType,
        COALESCE(s.gst_amount, p.gst_amount, 0) AS gst,
        e.expense_category AS category
      FROM cash_ledger cl
      LEFT JOIN sales s ON cl.reference_type = 'Sale' AND cl.reference_id = s.id 
        AND (s.delete_status IS NULL OR s.delete_status = 0)
      LEFT JOIN purchases p ON cl.reference_type = 'Purchase' AND cl.reference_id = p.id
        AND (p.delete_status IS NULL OR p.delete_status = 0)
      LEFT JOIN expenses e ON cl.reference_type = 'Expense' AND cl.reference_id = e.id
        AND (e.delete_status IS NULL OR e.delete_status = 0)
      WHERE ${cashWhere.join(" AND ")}
    `;

    // Bank SQL
    const bankSql = `
      SELECT
        bl.id,
        DATE_FORMAT(bl.txn_date,'%d-%m-%Y') AS date,
        bl.txn_date AS rawDate,
        bl.module AS type,
        bl.amount AS amount,
        bl.amount AS total,
        bl.description AS party,
        b.bank_name AS paymentMode,
        bl.type AS flowType,
        COALESCE(s.gst_amount, p.gst_amount, 0) AS gst,
        e.expense_category AS category
      FROM bank_ledger bl
      JOIN banks b ON bl.bank_id = b.id AND (b.delete_status IS NULL OR b.delete_status = 0)
      LEFT JOIN sales s ON bl.module = 'Sales' AND bl.reference_id = s.id
        AND (s.delete_status IS NULL OR s.delete_status = 0)
      LEFT JOIN purchases p ON bl.module = 'Purchase' AND bl.reference_id = p.id
        AND (p.delete_status IS NULL OR p.delete_status = 0)
      LEFT JOIN expenses e ON bl.module = 'Expense' AND bl.reference_id = e.id
        AND (e.delete_status IS NULL OR e.delete_status = 0)
      WHERE ${bankWhere.join(" AND ")}
    `;

    // Credit SQL
    const creditSql = `
      SELECT
        clg.id,
        DATE_FORMAT(clg.txn_date,'%d-%m-%Y') AS date,
        clg.txn_date AS rawDate,
        clg.reference_type AS type,
        clg.amount AS amount,
        clg.amount AS total,
        COALESCE(pty.name, clg.note) AS party,
        'Credit' AS paymentMode,
        NULL AS flowType,
        COALESCE(s.gst_amount, p.gst_amount, 0) AS gst,
        e.expense_category AS category
      FROM credit_ledger clg
      LEFT JOIN parties pty ON clg.party_id = pty.id AND pty.company_id = ?
        AND (pty.delete_status IS NULL OR pty.delete_status = 0)
      LEFT JOIN sales s ON clg.reference_type = 'Sale' AND clg.reference_id = s.id
        AND (s.delete_status IS NULL OR s.delete_status = 0)
      LEFT JOIN purchases p ON clg.reference_type = 'Purchase' AND clg.reference_id = p.id
        AND (p.delete_status IS NULL OR p.delete_status = 0)
      LEFT JOIN expenses e ON clg.reference_type = 'Expense' AND clg.reference_id = e.id
        AND (e.delete_status IS NULL OR e.delete_status = 0)
      WHERE ${creditWhere.join(" AND ")}
    `;

    // --- 5. Data Fetching ---

    const allParams = [
      ...cashParams,
      ...bankParams,
      companyId, // For credit ledger parties join
      ...creditParams
    ];

    // 5a. Main Transaction List
    let unionSql = `
      SELECT * FROM (
        ${cashSql}
        UNION ALL
        ${bankSql}
        UNION ALL
        ${creditSql}
      ) AS unified
      ORDER BY rawDate DESC
    `;

    // Pagination
    const finalParams = [...allParams];
    if (!fetchAll) {
      unionSql += ` LIMIT ? OFFSET ?`;
      finalParams.push(pageLimit, offset);
    }

    const [transactions] = await db.query(unionSql, finalParams);

    // 5b. Summary Stats (Total Sales, Purchases, GST, Net Profit)
    const summarySql = `
      SELECT
        SUM(CASE WHEN type IN ('Sale','Sales') THEN amount ELSE 0 END) AS totalSales,
        SUM(CASE WHEN type IN ('Purchase') THEN amount ELSE 0 END) AS totalPurchases,
        SUM(CASE WHEN type IN ('Expense') THEN amount ELSE 0 END) AS totalExpenses,
        SUM(gst) AS totalGST
      FROM (
        ${cashSql}
        UNION ALL
        ${bankSql}
        UNION ALL
        ${creditSql}
      ) AS s
    `;

    const [sumRows] = await db.query(summarySql, allParams);
    const s = sumRows[0] || {};

    // 5c. Category Breakdown (For Charts)
    const categorySql = `
      SELECT 
        IFNULL(category, 'Uncategorized') AS name, 
        SUM(amount) AS value
      FROM (
        ${cashSql}
        UNION ALL
        ${bankSql}
        UNION ALL
        ${creditSql}
      ) AS unified
      WHERE type IN ('Expense')
      GROUP BY category
    `;

    const [categoryTotals] = await db.query(categorySql, allParams);

    // 5d. Total Row Count
    const countSql = `
      SELECT COUNT(*) AS totalRows FROM (
        ${cashSql}
        UNION ALL
        ${bankSql}
        UNION ALL
        ${creditSql}
      ) AS unified
    `;
    const [[{ totalRows }]] = await db.query(countSql, allParams);

    // --- 6. Response ---
    respond(res, {
      transactions,
      summary: {
        totalSales: s.totalSales || 0,
        totalPurchases: s.totalPurchases || 0,
        totalExpenses: s.totalExpenses || 0,
        totalGST: s.totalGST || 0,
        netProfit: (s.totalSales || 0) - (s.totalPurchases || 0) - (s.totalExpenses || 0),
      },
      categoryTotals,
      pagination: {
        totalRows,
        page: pageNum,
        limit: fetchAll ? totalRows : pageLimit,
      },
    });

  } catch (err) {
    console.error("getMonthlyReport ERR:", err);
    res.status(500).json({ msg: err.message });
  }
};

/* ============================================================================ 
   DAILY REPORT (Null-safe)
============================================================================ */
export const getDailyReport = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const [[cashStats]] = await db.query(
      `SELECT 
          SUM(CASE WHEN reference_type='Sale' THEN amount ELSE 0 END) AS sales_cash,
          SUM(CASE WHEN reference_type='Purchase' THEN amount ELSE 0 END) AS purchase_cash,
          SUM(CASE WHEN reference_type='Expense' THEN amount ELSE 0 END) AS expense_cash
       FROM cash_ledger
       WHERE company_id = ?
       AND DATE(txn_date) = CURDATE()
       AND (delete_status IS NULL OR delete_status = 0)
       AND reference_type NOT IN ('CustomerPayment','SupplierPayment')`,
      [companyId]
    );

    const [[bankStats]] = await db.query(
      `SELECT 
          SUM(CASE WHEN module='Sales' THEN amount ELSE 0 END) AS sales_online,
          SUM(CASE WHEN module='Purchase' THEN amount ELSE 0 END) AS purchase_online,
          SUM(CASE WHEN module='Expense' THEN amount ELSE 0 END) AS expense_online
       FROM bank_ledger
       WHERE company_id = ?
       AND DATE(txn_date) = CURDATE()
       AND (delete_status IS NULL OR delete_status = 0)
       AND module NOT IN ('CustomerPayment','SupplierPayment')`,
      [companyId]
    );

    respond(res, {
      sales: {
        cash: cashStats.sales_cash || 0,
        online: bankStats.sales_online || 0,
      },
      purchase: {
        cash: cashStats.purchase_cash || 0,
        online: bankStats.purchase_online || 0,
      },
      expense: {
        cash: cashStats.expense_cash || 0,
        online: bankStats.expense_online || 0,
      },
    });

  } catch (err) {
    console.error("Daily report error:", err);
    res.status(500).json({ msg: err.message });
  }
};

/* ============================================================================ 
   BANK SUMMARY
============================================================================ */
export const getBankSummary = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { start, end } = req.query;

    let dateFilter = "";
    const params = [companyId];

    if (start && end) {
      dateFilter = " AND bl.txn_date BETWEEN ? AND ? ";
      params.push(start, end);
    }
    
    // Add companyId again for the JOIN condition if needed, or rearrange query
    // Simplified logic:
    const sql = `
      SELECT 
        b.id AS bank_id,
        b.bank_name,
        b.account_no,
        b.account_balance,
        IFNULL(SUM(CASE WHEN bl.type='Credit' THEN bl.amount ELSE 0 END),0) AS total_credit,
        IFNULL(SUM(CASE WHEN bl.type='Debit' THEN bl.amount ELSE 0 END),0) AS total_debit
      FROM banks b
      LEFT JOIN bank_ledger bl 
        ON bl.bank_id = b.id 
        AND bl.company_id = b.company_id 
        AND (bl.delete_status IS NULL OR bl.delete_status = 0)
        ${dateFilter}
      WHERE b.company_id = ? 
      AND (b.delete_status IS NULL OR b.delete_status = 0)
      GROUP BY b.id
    `;
    
    // Params need to be carefully ordered: [start, end, companyId] if filter exists
    // Actually JOIN condition params come first.
    // Let's restructure safely:
    const finalParams = start && end ? [start, end, companyId] : [companyId];
    
    const [rows] = await db.query(sql, finalParams);
    respond(res, rows);

  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/* ============================================================================ 
   OUTSTANDING REPORT
============================================================================ */
export const getOutstanding = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const sql = `
      SELECT 
        cl.party_id,
        p.name AS party_name,
        SUM(CASE WHEN cl.type='CustomerCredit' THEN cl.amount ELSE 0 END) AS total_customer_credit,
        SUM(CASE WHEN cl.type='SupplierCredit' THEN cl.amount ELSE 0 END) AS total_supplier_credit
      FROM credit_ledger cl
      LEFT JOIN parties p ON cl.party_id = p.id 
        AND p.company_id = ?
        AND (p.delete_status IS NULL OR p.delete_status = 0)
      WHERE cl.company_id = ? 
        AND (cl.delete_status IS NULL OR cl.delete_status = 0)
      GROUP BY cl.party_id
    `;

    const [rows] = await db.query(sql, [companyId, companyId]);
    respond(res, rows);

  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/* ============================================================================ 
   PLACEHOLDER REPORTS
============================================================================ */
export const getGstSummary = (_, res) => res.json({ msg: "ok" });
export const getMachineryReport = (_, res) => res.json({ msg: "ok" });
export const getDateRangeReport = (_, res) => res.json({ msg: "Deprecated" });