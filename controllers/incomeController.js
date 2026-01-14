import { db } from "../config/db.js";

const respond = (res, data = null, msg = "Success", code = 200) =>
  res.status(code === 201 ? 201 : code).json({ msg, data });

/* ============================================================================
   ADD INCOME
============================================================================ */
export const addIncome = async (req, res) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;

    const {
      income_name,
      income_category,
      amount,
      income_date,
      payment_type, // Cash | Online
      payer_name,
      reference_no,
      remarks,
      bank_id
    } = req.body;

    const incomeAmount = Number(amount);
    if (!incomeAmount || incomeAmount <= 0) {
      return respond(res, null, "Invalid amount", 400);
    }

    if (payment_type === "Online" && !bank_id) {
      return respond(res, null, "Bank is required for Online payment", 400);
    }

    // 1. Insert Income Record
    const [result] = await connection.query(
      `
      INSERT INTO income (
        income_name, income_category, amount, income_date, payment_type,
        payer_name, reference_no, remarks, bank_id,
        company_id, created_by, delete_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `,
      [
        income_name,
        income_category,
        incomeAmount,
        income_date,
        payment_type,
        payer_name || null,
        reference_no || null,
        remarks || null,
        bank_id || null,
        companyId,
        userId
      ]
    );

    const incomeId = result.insertId;

    // 2. Handle Ledgers (Money IN -> Credit)

    // A) CASH
    if (payment_type === "Cash") {
      // Add to Cash In Hand
      await connection.query(
        `INSERT INTO cash_in_hand (company_id, current_balance) VALUES (?, ?) 
         ON DUPLICATE KEY UPDATE current_balance = current_balance + VALUES(current_balance), updated_at = NOW()`,
        [companyId, incomeAmount]
      );

      // Cash Ledger Entry
      await connection.query(
        `INSERT INTO cash_ledger 
         (company_id, type, amount, txn_date, reference_type, reference_id, note, created_by, delete_status) 
         VALUES (?, 'Credit', ?, ?, 'Income', ?, ?, ?, 0)`,
        [companyId, incomeAmount, income_date, incomeId, `Income: ${income_name}`, userId]
      );
    }

    // B) ONLINE (BANK)
    else if (payment_type === "Online" && bank_id) {
      // Add to Bank Balance
      await connection.query(
        `UPDATE banks SET account_balance = account_balance + ? WHERE id = ? AND company_id = ?`,
        [incomeAmount, bank_id, companyId]
      );

      // Bank Ledger Entry
      await connection.query(
        `INSERT INTO bank_ledger 
         (company_id, bank_id, type, amount, txn_date, module, reference_id, description, created_by, delete_status) 
         VALUES (?, ?, 'Credit', ?, ?, 'Income', ?, ?, ?, 0)`,
        [companyId, bank_id, incomeAmount, income_date, incomeId, `Income: ${income_name}`, userId]
      );
    }

    await connection.commit();
    return respond(res, { id: incomeId }, "Income Added Successfully", 201);

  } catch (err) {
    await connection.rollback();
    console.error("addIncome Error:", err);
    return respond(res, null, err.message, 500);
  } finally {
    connection.release();
  }
};

/* ============================================================================
   GET INCOMES (Paginated)
============================================================================ */
export const getIncomes = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM income WHERE company_id = ? AND delete_status = 0`,
      [companyId]
    );

    const [rows] = await db.query(
      `
      SELECT 
        i.*,
        DATE_FORMAT(i.income_date, '%d-%m-%Y') as income_date_formatted,
        b.bank_name,
        u.name AS created_by_name
      FROM income i
      LEFT JOIN banks b ON i.bank_id = b.id
      LEFT JOIN USERS u on i.created_by =u.id
      WHERE i.company_id = ? AND i.delete_status = 0
      ORDER BY i.income_date DESC, i.id DESC
      LIMIT ? OFFSET ?
      `,
      [companyId, limit, offset]
    );

    return respond(res, { records: rows, total, page, limit });

  } catch (err) {
    console.error("getIncomes error:", err);
    return respond(res, null, err.message, 500);
  }
};

/* ============================================================================
   GET INCOME BY ID
============================================================================ */
export const getIncomeById = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;

    const [rows] = await db.query(
      `SELECT * FROM income WHERE id = ? AND company_id = ? AND delete_status = 0`,
      [id, companyId]
    );

    if (!rows.length) return respond(res, null, "Income not found", 404);

    return respond(res, rows[0]);
  } catch (err) {
    return respond(res, null, err.message, 500);
  }
};

/* ============================================================================
   UPDATE INCOME
============================================================================ */
export const updateIncome = async (req, res) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    const companyId = req.user.companyId;
    const userId = req.user.id;
    const { id } = req.params;

    const {
      income_name,
      income_category,
      amount,
      income_date,
      payment_type,
      payer_name,
      reference_no,
      remarks,
      bank_id
    } = req.body;

    const newAmount = Number(amount);

    // 1. Fetch Old Data
    const [[oldIncome]] = await connection.query(
      `SELECT * FROM income WHERE id = ? AND company_id = ? FOR UPDATE`,
      [id, companyId]
    );

    if (!oldIncome) {
      await connection.rollback();
      return respond(res, null, "Income not found", 404);
    }

    // 2. REVERSE OLD TRANSACTION (Deduct money back)
    const oldAmount = Number(oldIncome.amount);

    if (oldIncome.payment_type === "Cash") {
      await connection.query(
        `UPDATE cash_in_hand SET current_balance = current_balance - ? WHERE company_id = ?`,
        [oldAmount, companyId]
      );
      await connection.query(
        `DELETE FROM cash_ledger WHERE reference_type = 'Income' AND reference_id = ?`,
        [id]
      );
    } 
    else if (oldIncome.payment_type === "Online" && oldIncome.bank_id) {
      await connection.query(
        `UPDATE banks SET account_balance = account_balance - ? WHERE id = ?`,
        [oldAmount, oldIncome.bank_id]
      );
      await connection.query(
        `DELETE FROM bank_ledger WHERE module = 'Income' AND reference_id = ?`,
        [id]
      );
    }

    // 3. UPDATE INCOME TABLE (Removed modified_by)
    await connection.query(
      `
      UPDATE income SET
        income_name=?, income_category=?, amount=?, income_date=?, 
        payment_type=?, payer_name=?, reference_no=?, remarks=?, bank_id=?
      WHERE id=? AND company_id=?
      `,
      [
        income_name,
        income_category,
        newAmount,
        income_date,
        payment_type,
        payer_name,
        reference_no,
        remarks,
        bank_id || null,
        id,
        companyId
      ]
    );

    // 4. APPLY NEW TRANSACTION (Add new amount)
    if (payment_type === "Cash") {
      await connection.query(
        `UPDATE cash_in_hand SET current_balance = current_balance + ? WHERE company_id = ?`,
        [newAmount, companyId]
      );
      await connection.query(
        `INSERT INTO cash_ledger 
         (company_id, type, amount, txn_date, reference_type, reference_id, note, created_by, delete_status) 
         VALUES (?, 'Credit', ?, ?, 'Income', ?, ?, ?, 0)`,
        [companyId, newAmount, income_date, id, `Income: ${income_name}`, userId]
      );
    }
    else if (payment_type === "Online" && bank_id) {
      await connection.query(
        `UPDATE banks SET account_balance = account_balance + ? WHERE id = ?`,
        [newAmount, bank_id]
      );
      await connection.query(
        `INSERT INTO bank_ledger 
         (company_id, bank_id, type, amount, txn_date, module, reference_id, description, created_by, delete_status) 
         VALUES (?, ?, 'Credit', ?, ?, 'Income', ?, ?, ?, 0)`,
        [companyId, bank_id, newAmount, income_date, id, `Income: ${income_name}`, userId]
      );
    }

    await connection.commit();
    return respond(res, null, "Income updated successfully");

  } catch (err) {
    await connection.rollback();
    console.error("updateIncome Error:", err);
    return respond(res, null, "Failed to update income", 500);
  } finally {
    connection.release();
  }
};

/* ============================================================================
   DELETE INCOME (Fix: Removed modified_by)
============================================================================ */
export const deleteIncome = async (req, res) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    const { id } = req.params;
    const companyId = req.user.companyId;

    // 1. Fetch Income
    const [[income]] = await connection.query(
      `SELECT payment_type, amount, bank_id FROM income 
       WHERE id = ? AND company_id = ? AND delete_status = 0`,
      [id, companyId]
    );

    if (!income) {
      await connection.rollback();
      return respond(res, null, "Income not found or already deleted", 404);
    }

    // 2. Soft Delete Income (REMOVED modified_by)
    await connection.query(
      `UPDATE income SET delete_status = 1 WHERE id = ? AND company_id = ?`,
      [id, companyId]
    );

    // 3. Reverse Finances (Deduct Money Back)
    const amt = Number(income.amount);

    if (income.payment_type === "Cash") {
      // Reduce Cash Wallet
      await connection.query(
        `UPDATE cash_in_hand SET current_balance = current_balance - ? WHERE company_id = ?`,
        [amt, companyId]
      );
      // Hide Ledger
      await connection.query(
        `UPDATE cash_ledger SET delete_status = 1 WHERE reference_type='Income' AND reference_id=?`,
        [id]
      );
    } 
    else if (income.payment_type === "Online" && income.bank_id) {
      // Reduce Bank Balance
      await connection.query(
        `UPDATE banks SET account_balance = account_balance - ? WHERE id = ?`,
        [amt, income.bank_id]
      );
      // Hide Ledger
      await connection.query(
        `UPDATE bank_ledger SET delete_status = 1 WHERE module='Income' AND reference_id=?`,
        [id]
      );
    }

    await connection.commit();
    return respond(res, null, "Income deleted successfully");

  } catch (err) {
    await connection.rollback();
    console.error("deleteIncome Error:", err);
    return respond(res, null, "Failed to delete income", 500);
  } finally {
    connection.release();
  }
};