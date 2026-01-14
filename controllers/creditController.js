import { db } from "../config/db.js";

/* uniform responder helper */
const respond = (res, data = null, msg = "Success", status = 200) =>
  res.status(status).json({ msg, data: Array.isArray(data) ? data : data });

/* =====================================================================
   Add Credit Entry
   - Use from addSale/addPurchase/addExpense when payment_type === 'Credit'
   - type: 'CustomerCredit' | 'SupplierCredit' | 'ExpenseCredit'
===================================================================== */
export const addCreditEntry = async (req, res) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    const companyId = req.user.companyId;
    const userId = req.user.id;
    const {
      type,
      party_id = null,
      amount,
      txn_date,
      reference_type = null,
      reference_id = null,
      note = null
    } = req.body;

    if (!type || !amount || !txn_date) {
      throw new Error("type, amount, txn_date are required");
    }

    const amt = Number(amount);
    if (isNaN(amt) || amt <= 0) throw new Error("Invalid amount");

    await connection.query(
      `INSERT INTO credit_ledger
       (company_id, type, party_id, amount, txn_date, reference_type, reference_id, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, type, party_id, amt, txn_date, reference_type, reference_id, note, userId]
    );

    await connection.commit();
    connection.release();

    return res.status(201).json({ msg: "Credit entry created" });

  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error("addCreditEntry error:", err);
    return res.status(500).json({ msg: err.message || "Server error" });
  }
};


/* =====================================================================
   Get Credit Ledger (paginated + filterable)
===================================================================== */
export const getCreditLedger = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { type, party_id, startDate, endDate } = req.query;

    let where = ["company_id = ?", "delete_status = 0"];
    const params = [companyId];

    if (type) { where.push("type = ?"); params.push(type); }
    if (party_id) { where.push("party_id = ?"); params.push(party_id); }
    if (startDate && endDate) { where.push("DATE(txn_date) BETWEEN ? AND ?"); params.push(startDate, endDate); }

    const sql = `
      SELECT id, type, party_id, amount, DATE_FORMAT(txn_date,'%d-%m-%Y') AS date, txn_date, reference_type, reference_id, note, created_by, created_at
      FROM credit_ledger
      WHERE ${where.join(" AND ")}
      ORDER BY txn_date DESC, id DESC
      LIMIT ? OFFSET ?
    `;
    params.push(limit, offset);

    const [rows] = await db.query(sql, params);

    const countSql = `SELECT COUNT(*) AS total FROM credit_ledger WHERE ${where.join(" AND ")}`;
    const [[{ total }]] = await db.query(countSql, params.slice(0, -2));

    return res.status(200).json({ msg: "Success", data: Array.isArray(rows) ? rows : [], total: total || 0, page, limit });
  } catch (err) {
    console.error("getCreditLedger error:", err);
    return res.status(500).json({ msg: "Server error" });
  }
};


/* =====================================================================
   Get Outstanding summary using credit_ledger and payments from ledgers
   - customers (CustomerCredit) and suppliers (SupplierCredit)
===================================================================== */
export const getOutstandingSummary = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { party_type = "Customer" } = req.query; // Customer | Supplier | Vendor

    // For customers: type = 'CustomerCredit'
    const creditType = party_type === "Supplier" ? "SupplierCredit" : (party_type === "Expense" ? "ExpenseCredit" : "CustomerCredit");

    /* 
      Strategy:
        total_credit = SUM(credit_ledger.amount) per party
        total_payments = SUM(payments recorded in bank_ledger + cash_ledger that reference the original reference_type/reference_id)
        outstanding = total_credit - total_payments
      NOTE: this assumes that payments against a sale/purchase generate ledger entries with reference_type matching the original reference (Sale/Purchase) and reference_id = original id.
    */

    const sql = `
      SELECT
        cl.party_id,
        p.name AS party_name,
        IFNULL(SUM(cl.amount),0) AS total_credit,
        IFNULL((
          SELECT SUM(IFNULL(x.pay_amt,0)) FROM (
            -- payments from bank_ledger referencing same company and same reference (Sale/Purchase)
            SELECT COALESCE(SUM(bl.amount),0) AS pay_amt
            FROM bank_ledger bl
            WHERE bl.company_id = ? 
              AND bl.module = cl.reference_type
              AND bl.reference_id = cl.reference_id
            UNION ALL
            -- payments from cash_ledger referencing same reference
            SELECT COALESCE(SUM(clg.amount),0) AS pay_amt
            FROM cash_ledger clg
            WHERE clg.company_id = ?
              AND clg.reference_type = cl.reference_type
              AND clg.reference_id = cl.reference_id
          ) x
        ),0) AS total_payments
      FROM credit_ledger cl
      LEFT JOIN parties p ON p.id = cl.party_id AND p.company_id = ?
      WHERE cl.company_id = ? AND cl.type = ?
      GROUP BY cl.party_id, p.name
    `;

    const [rows] = await db.query(sql, [companyId, companyId, companyId, companyId, creditType]);

    // compute outstanding = total_credit - total_payments
    const result = rows.map(r => ({
      party_id: r.party_id,
      party_name: r.party_name,
      total_credit: Number(r.total_credit || 0),
      total_payments: Number(r.total_payments || 0),
      outstanding: Number((Number(r.total_credit || 0) - Number(r.total_payments || 0)).toFixed(2))
    }));

    return res.status(200).json({ msg: "Success", data: result });
  } catch (err) {
    console.error("getOutstandingSummary error:", err);
    return res.status(500).json({ msg: err.message });
  }
};
