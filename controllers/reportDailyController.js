import { db } from "../config/db.js";

/* ======================================================
   DAILY REPORT SUMMARY (Sales Revenue Only + Expenses + Purchases)
====================================================== */
export const getDailyMonthReport = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { month, startDate, endDate } = req.query;

    let start, end;

    if (startDate && endDate) {
      start = `${startDate} 00:00:00`;
      end = `${endDate} 23:59:59`;
    } else if (month) {
      const [y, m] = month.split("-");
      const lastDay = new Date(y, m, 0).getDate();
      start = `${y}-${m}-01 00:00:00`;
      end = `${y}-${m}-${lastDay} 23:59:59`;
    } else {
      return res.status(400).json({ msg: "Date range required" });
    }

    /* ================= SALES ================= */

    // 1. CASH SALES
    const [salesCash] = await db.query(
      `SELECT DATE_FORMAT(txn_date, '%Y-%m-%d') as d, SUM(amount) amt
       FROM cash_ledger
       WHERE company_id=? AND reference_type='Sale'
       AND type='Credit'
       AND txn_date BETWEEN ? AND ?
       AND (delete_status IS NULL OR delete_status=0)
       GROUP BY d`,
      [companyId, start, end]
    );

    // 2. ONLINE SALES
    const [salesOnline] = await db.query(
      `SELECT DATE_FORMAT(txn_date, '%Y-%m-%d') as d, SUM(amount) amt
       FROM bank_ledger
       WHERE company_id=? AND module='Sales'
       AND type='Credit'
       AND txn_date BETWEEN ? AND ?
       AND (delete_status IS NULL OR delete_status=0)
       GROUP BY d`,
      [companyId, start, end]
    );

    // 3. CREDIT SALES
    const [salesCredit] = await db.query(
      `SELECT DATE_FORMAT(sale_date, '%Y-%m-%d') as d, SUM(final_amount) amt
       FROM sales
       WHERE company_id=? AND payment_type='Credit'
       AND sale_date BETWEEN DATE(?) AND DATE(?)
       AND (delete_status IS NULL OR delete_status=0)
       GROUP BY d`,
      [companyId, start, end]
    );

    /* ================= PURCHASES ================= */

    // 4. CASH PURCHASES (From Cash Ledger - Debit - Purchase)
    const [purchaseCash] = await db.query(
      `SELECT DATE_FORMAT(txn_date, '%Y-%m-%d') as d, SUM(amount) amt
       FROM cash_ledger
       WHERE company_id=? AND reference_type='Purchase'
       AND type='Debit'
       AND txn_date BETWEEN ? AND ?
       AND (delete_status IS NULL OR delete_status=0)
       GROUP BY d`,
      [companyId, start, end]
    );

    // 5. ONLINE PURCHASES (From Bank Ledger - Debit - Purchase)
    const [purchaseOnline] = await db.query(
      `SELECT DATE_FORMAT(txn_date, '%Y-%m-%d') as d, SUM(amount) amt
       FROM bank_ledger
       WHERE company_id=? AND module='Purchase'
       AND type='Debit'
       AND txn_date BETWEEN ? AND ?
       AND (delete_status IS NULL OR delete_status=0)
       GROUP BY d`,
      [companyId, start, end]
    );

    // 6. CREDIT PURCHASES (From Purchases Table)
    const [purchaseCredit] = await db.query(
      `SELECT DATE_FORMAT(purchase_date, '%Y-%m-%d') as d, SUM(final_amount) amt
       FROM purchases
       WHERE company_id=? AND payment_type='Credit'
       AND purchase_date BETWEEN DATE(?) AND DATE(?)
       AND (delete_status IS NULL OR delete_status=0)
       GROUP BY d`,
      [companyId, start, end]
    );

    /* ================= EXPENSES ================= */

    // 7. CASH EXPENSES (From Cash Ledger - Debit - Expense)
    const [expenseCash] = await db.query(
      `SELECT DATE_FORMAT(txn_date, '%Y-%m-%d') as d, SUM(amount) amt
       FROM cash_ledger
       WHERE company_id=? AND reference_type='Expense'
       AND type='Debit'
       AND txn_date BETWEEN ? AND ?
       AND (delete_status IS NULL OR delete_status=0)
       GROUP BY d`,
      [companyId, start, end]
    );

    // 8. ONLINE EXPENSES (From Bank Ledger - Debit - Expense)
    const [expenseOnline] = await db.query(
      `SELECT DATE_FORMAT(txn_date, '%Y-%m-%d') as d, SUM(amount) amt
       FROM bank_ledger
       WHERE company_id=? AND module='Expense'
       AND type='Debit'
       AND txn_date BETWEEN ? AND ?
       AND (delete_status IS NULL OR delete_status=0)
       GROUP BY d`,
      [companyId, start, end]
    );

    /* ================= HELPERS ================= */

    const toMap = (rows) => {
      const m = new Map();
      rows.forEach(r => m.set(r.d, Number(r.amt || 0)));
      return m;
    };

    const salesCashMap = toMap(salesCash);
    const salesOnlineMap = toMap(salesOnline);
    const salesCreditMap = toMap(salesCredit);

    const purchaseCashMap = toMap(purchaseCash);
    const purchaseOnlineMap = toMap(purchaseOnline);
    const purchaseCreditMap = toMap(purchaseCredit);

    const expenseCashMap = toMap(expenseCash);
    const expenseOnlineMap = toMap(expenseOnline);

    /* ================= FINAL LOOP ================= */

    const rows = [];
    const totals = {
      cash: 0,
      online: 0,
      credit: 0,
      totalSales: 0,

      purchaseCash: 0,
      purchaseOnline: 0,
      purchaseCredit: 0,
      purchases: 0,

      expenseCash: 0,
      expenseOnline: 0,
      expenses: 0,

      netProfit: 0,
    };

    let cursor = new Date(start.split(" ")[0]);
    const endDt = new Date(end.split(" ")[0]);
    let day = 1;

    while (cursor <= endDt) {
      // Robust string date generation (YYYY-MM-DD)
      const year = cursor.getFullYear();
      const month = String(cursor.getMonth() + 1).padStart(2, "0");
      const dt = String(cursor.getDate()).padStart(2, "0");
      const iso = `${year}-${month}-${dt}`;

      // Sales
      const cash = salesCashMap.get(iso) || 0;
      const online = salesOnlineMap.get(iso) || 0;
      const credit = salesCreditMap.get(iso) || 0;
      const totalSales = cash + online + credit;

      // Purchases
      const purchaseCashVal = purchaseCashMap.get(iso) || 0;
      const purchaseOnlineVal = purchaseOnlineMap.get(iso) || 0;
      const purchaseCreditVal = purchaseCreditMap.get(iso) || 0;
      const purchases = purchaseCashVal + purchaseOnlineVal + purchaseCreditVal;

      // Expenses
      const expenseCashVal = expenseCashMap.get(iso) || 0;
      const expenseOnlineVal = expenseOnlineMap.get(iso) || 0;
      const expenses = expenseCashVal + expenseOnlineVal;

      const netProfit = totalSales - purchases - expenses;

      // Aggregate Totals
      totals.cash += cash;
      totals.online += online;
      totals.credit += credit;
      totals.totalSales += totalSales;

      totals.purchaseCash += purchaseCashVal;
      totals.purchaseOnline += purchaseOnlineVal;
      totals.purchaseCredit += purchaseCreditVal;
      totals.purchases += purchases;

      totals.expenseCash += expenseCashVal;
      totals.expenseOnline += expenseOnlineVal;
      totals.expenses += expenses;

      totals.netProfit += netProfit;

      rows.push({
        day: day++,
        date: iso,

        cash,
        online,
        credit,
        totalSales,

        purchaseCash: purchaseCashVal,
        purchaseOnline: purchaseOnlineVal,
        purchaseCredit: purchaseCreditVal,
        purchases,

        expenseCash: expenseCashVal,
        expenseOnline: expenseOnlineVal,
        expenses,

        netProfit,
      });

      cursor.setDate(cursor.getDate() + 1);
    }

    res.json({ msg: "Daily Report Summary", data: { rows, totals } });

  } catch (err) {
    console.error("DailyMonthReport error:", err);
    res.status(500).json({ msg: "Server error" });
  }
};

/* ======================================================
   CREDIT OUTSTANDING REPORT (Calculated Logic)
====================================================== */
export const getCreditOutstandingReport = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { month, startDate, endDate } = req.query;

    let start, end;
    if (startDate && endDate) {
      start = startDate;
      end = endDate;
    } else if (month) {
      const [y, m] = month.split("-");
      start = `${y}-${m}-01`;
      end = `${y}-${m}-${new Date(y, m, 0).getDate()}`;
    } else {
      return res.status(400).json({ msg: "Date filter required" });
    }

    // ✅ CALCULATION: Total Received = (Total Sales - Total Remaining)
    // This is safer than relying on a separate payments table join which might cause duplication.
    const [rows] = await db.query(
      `
      SELECT
        p.id AS party_id,
        COALESCE(p.name, s.customer_name) AS party_name,
        SUM(s.final_amount) AS total_sale_amount,
        (SUM(s.final_amount) - SUM(s.outstanding)) AS total_received,
        SUM(s.outstanding) AS total_remaining
      FROM sales s
      LEFT JOIN parties p
        ON p.id = s.party_id AND p.company_id = s.company_id
      WHERE s.company_id = ?
        AND (s.delete_status IS NULL OR s.delete_status = 0)
        AND (p.delete_status IS NULL OR p.delete_status = 0)
        AND s.outstanding > 0 -- Only show those who owe money
        AND s.sale_date BETWEEN ? AND ?
      GROUP BY p.id, p.name, s.customer_name
      ORDER BY party_name
      `,
      [companyId, start, end]
    );

    const totalOutstanding = rows.reduce(
      (s, r) => s + Number(r.total_remaining || 0),
      0
    );

    res.json({
      msg: "Credit Outstanding",
      data: { rows, totalOutstanding },
    });
  } catch (err) {
    console.error("getCreditOutstandingReport Error:", err);
    res.status(500).json({ msg: "Server error" });
  }
};

/* ======================================================
   GOODS SALE SUMMARY
====================================================== */
export const getGoodsSaleReport = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { startDate, endDate, month } = req.query;

    let start, end;
    if (startDate && endDate) {
      start = startDate;
      end = endDate;
    } else if (month) {
      const [y, m] = month.split("-");
      start = `${y}-${m}-01`;
      end = `${y}-${m}-${new Date(y, m, 0).getDate()}`;
    } else {
      return res.status(400).json({ msg: "Date filter required" });
    }

    const [rows] = await db.query(
      `
      SELECT i.itemName, i.unit, SUM(si.quantity) quantity
      FROM sales s
      JOIN sale_items si ON si.sale_id = s.id
      JOIN items i ON i.id = si.item_id
      WHERE s.company_id=? 
        AND (s.delete_status IS NULL OR s.delete_status = 0)
        AND s.sale_date BETWEEN ? AND ?
      GROUP BY i.id, i.itemName, i.unit
      ORDER BY i.itemName
      `,
      [companyId, start, end]
    );

    res.json({ msg: "Goods Sale Summary", data: { rows } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error" });
  }
};

/* ======================================================
   EXPENSE REPORT
====================================================== */
export const getExpenseReport = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { startDate, endDate, month } = req.query;

    let start, end;
    if (startDate && endDate) {
      start = startDate;
      end = endDate;
    } else if (month) {
      const [y, m] = month.split("-");
      start = `${y}-${m}-01`;
      end = `${y}-${m}-${new Date(y, m, 0).getDate()}`;
    } else {
      return res.status(400).json({ msg: "Date filter required" });
    }

    const [rows] = await db.query(
      `
      SELECT 
        DATE_FORMAT(expense_date, '%d-%m-%Y') AS expense_date,
        expense_name,
        expense_category,
        payment_type,
        amount
      FROM expenses
      WHERE company_id = ?
        AND (delete_status IS NULL OR delete_status = 0)
        AND expense_date BETWEEN ? AND ?
      ORDER BY expense_date
      `,
      [companyId, start, end]
    );

    const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);

    res.json({ msg: "Expense Report", data: { rows, total } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error" });
  }
};