import { db } from "../config/db.js";

// -------------------------------------------------------------
//  COMMON RESPONSE HANDLER
// -------------------------------------------------------------
const respond = (res, data = null, msg = "Success", status = 200) =>
  res.status(status).json({ msg, data });

/* ======================================================================
   1️⃣ GET BANK SUMMARY (Balance + Online Received)
====================================================================== */
export const getBankOnlineSummary = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const sql = `
      SELECT 
        b.id AS bank_id,
        b.bank_name,
        b.account_no,
        b.account_balance,
        IFNULL(SUM(CASE WHEN bl.type='Credit' THEN bl.amount ELSE 0 END),0) AS online_received
      FROM banks b
      LEFT JOIN bank_ledger bl ON bl.bank_id = b.id
      WHERE b.company_id = ? AND b.delete_status = 0
      GROUP BY b.id
      ORDER BY b.bank_name ASC
    `;

    const [rows] = await db.query(sql, [companyId]);

    return respond(res, rows);
  } catch (err) {
    console.error("getBankOnlineSummary ERROR:", err);
    return res.status(500).json({ msg: "Server error" });
  }
};

/* ======================================================================
   2️⃣ ADD BANK ENTRY (Deposit / Withdraw)
====================================================================== */
export const addBankEntry = async (req, res) => {
  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    const companyId = req.user.companyId;
    const userId = req.user.id;

    let { bank_id, type, amount, description, txn_date } = req.body;

    if (!bank_id) return respond(res, null, "bank_id is required", 400);

    amount = Number(amount);
    if (!amount || amount <= 0)
      return respond(res, null, "Invalid amount", 400);

    const ledgerType = type === "Deposit" ? "Credit" : "Debit";

    const txnDate = txn_date || new Date().toISOString().split("T")[0];

    // Update bank balance
    await conn.query(
      `
      UPDATE banks 
      SET account_balance = account_balance + ?
      WHERE id = ? AND company_id = ? AND delete_status = 0
      `,
      [ledgerType === "Credit" ? amount : -amount, bank_id, companyId]
    );

    // Insert ledger entry
    await conn.query(
      `
      INSERT INTO bank_ledger
      (company_id, bank_id, type, amount, txn_date, module, description, created_by)
      VALUES (?, ?, ?, ?, ?, 'Manual', ?, ?)
      `,
      [companyId, bank_id, ledgerType, amount, txnDate, description || "", userId]
    );

    await conn.commit();
    conn.release();

    return respond(res, null, "Bank entry added successfully");
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error("addBankEntry ERR:", err);
    return res.status(500).json({ msg: "Failed to add bank entry" });
  }
};

/* ======================================================================
   3️⃣ GET BANK LEDGER (Paginated)
====================================================================== */
export const getBankLedger = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    let page = Number(req.query.page) || 1;
    let limit = Number(req.query.limit) || 20;
    let offset = (page - 1) * limit;
    let bankId = req.query.bankId || "";

    let sql = `
      SELECT 
        bl.id,
        bl.type,
        bl.amount,
        bl.txn_date,
        bl.description,
        b.bank_name,
        b.account_no
      FROM bank_ledger bl
      JOIN banks b 
        ON bl.bank_id = b.id 
       AND b.delete_status = 0
      WHERE bl.company_id = ?
        AND (bl.delete_status IS NULL OR bl.delete_status = 0)
    `;

    const params = [companyId];

    if (bankId) {
      sql += " AND bl.bank_id = ?";
      params.push(bankId);
    }

    sql += " ORDER BY bl.txn_date DESC, bl.id DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const [records] = await db.query(sql, params);

    /* TOTAL COUNT */
    let countSql = `
      SELECT COUNT(*) AS total
      FROM bank_ledger bl
      JOIN banks b 
        ON bl.bank_id = b.id 
       AND b.delete_status = 0
      WHERE bl.company_id = ?
        AND (bl.delete_status IS NULL OR bl.delete_status = 0)
    `;

    const countParams = [companyId];

    if (bankId) {
      countSql += " AND bl.bank_id = ?";
      countParams.push(bankId);
    }

    const [[{ total }]] = await db.query(countSql, countParams);

    return respond(res, { records, total, page, limit });

  } catch (err) {
    console.error("getBankLedger ERROR:", err);
    return res.status(500).json({ msg: "Server error" });
  }
};

/* ======================================================================
   4️⃣ GET ONLINE BALANCE TOTAL
====================================================================== */
export const getBankBalances = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const sql = `
      SELECT SUM(account_balance) AS online_balance
      FROM banks
      WHERE company_id = ? AND delete_status = 0
    `;

    const [[row]] = await db.query(sql, [companyId]);

    return respond(res, row);
  } catch (err) {
    console.error("getBankBalances ERR:", err);
    return res.status(500).json({ msg: err.message });
  }
};
