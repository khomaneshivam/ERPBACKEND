import { db } from "../config/db.js";

const respond = (res, data = null, msg = "Success", status = 200) =>
  res.status(status).json({ msg, data });

/* ============================================================
   GET CASH IN HAND
============================================================ */
export const getCashInHand = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const [[row]] = await db.query(
      `SELECT current_balance FROM cash_in_hand WHERE company_id = ?`,
      [companyId]
    );

    const balance = row ? Number(row.current_balance) : 0;
    return respond(res, { current_balance: balance });
  } catch (err) {
    console.log("getCashInHand error:", err);
    return res.status(500).json({ msg: err.message });
  }
};

/* ============================================================
   ADD CASH ENTRY (Deposit / Withdraw)
   → Includes txn_date support
============================================================ */
export const addCashEntry = async (req, res) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    const companyId = req.user.companyId;
    const userId = req.user.id;

    let { type, amount, description, txn_date } = req.body;

    amount = Number(amount);
    if (!amount || amount <= 0)
      return res.status(400).json({ msg: "Invalid amount" });

    const ledgerType = type === "Deposit" ? "Credit" : "Debit";

    // Default txn_date = today
    const effectiveTxnDate =
      txn_date || new Date().toISOString().split("T")[0];

    /* -----------------------------
       1️⃣ UPDATE CASH IN HAND
    ------------------------------*/
    await connection.query(
      `
      INSERT INTO cash_in_hand(company_id, current_balance)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE 
        current_balance = current_balance + VALUES(current_balance),
        updated_at = NOW()
      `,
      [companyId, ledgerType === "Credit" ? amount : -amount]
    );

    /* -----------------------------
       2️⃣ INSERT CASH LEDGER ENTRY
       (Stores actual txn_date)
    ------------------------------*/
    await connection.query(
      `
      INSERT INTO cash_ledger 
      (company_id, type, amount, txn_date, reference_type, reference_id, note, created_by)
      VALUES (?, ?, ?, ?, 'Manual', NULL, ?, ?)
      `,
      [
        companyId,
        ledgerType,
        amount,
        effectiveTxnDate,
        description || "",
        userId,
      ]
    );

    await connection.commit();
    connection.release();

    return respond(res, null, "Cash entry added");
  } catch (err) {
    await connection.rollback();
    connection.release();
    console.log("addCashEntry error:", err);
    return res.status(500).json({ msg: "Failed to add entry" });
  }
};

/* ============================================================
   GET CASH LEDGER (Pagination + txn_date)
============================================================ */
export const getCashLedger = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    /* TOTAL COUNT */
    const [[{ total }]] = await db.query(
      `
      SELECT COUNT(*) AS total
      FROM cash_ledger
      WHERE company_id = ?
        AND (delete_status IS NULL OR delete_status = 0)
      `,
      [companyId]
    );

    /* DATA */
    const [rows] = await db.query(
      `
      SELECT 
        id,
        type,
        amount,
        note AS description,
        txn_date,
        created_at
      FROM cash_ledger
      WHERE company_id = ?
        AND (delete_status IS NULL OR delete_status = 0)
      ORDER BY txn_date DESC, created_at DESC
      LIMIT ? OFFSET ?
      `,
      [companyId, limit, offset]
    );

    return respond(res, { records: rows, total, page, limit });

  } catch (err) {
    console.error("getCashLedger error:", err);
    return res.status(500).json({ msg: err.message });
  }
};
