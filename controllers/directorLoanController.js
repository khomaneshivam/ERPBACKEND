import { db } from "../config/db.js";

/* ============================================================================
   ADD DIRECTOR LOAN
   - Handles Transaction (Loan Table + Bank/Cash Update + Ledger Entry)
============================================================================ */
export const addDirectorLoan = async (req, res) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    const {
      loan_date,
      director_id,
      amount,
      transaction_type, // "Received" (Inflow) or "Given" (Outflow)
      payment_type,     // "Cash" or "Online"
      bank_id,
      remark,
    } = req.body;

    const company_id = req.user.companyId;
    const created_by = req.user.id;

    // 1. INSERT LOAN RECORD
    const [insert] = await connection.query(
      `INSERT INTO director_loans
      (loan_date, director_id, amount, transaction_type, payment_type, bank_id, remark, company_id, created_by, delete_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        loan_date,
        director_id,
        amount,
        transaction_type,
        payment_type,
        bank_id || null,
        remark,
        company_id,
        created_by,
      ]
    );

    const loanId = insert.insertId;

    // 2. HANDLE BANK TRANSACTIONS
    if (payment_type === "Online" && bank_id) {
      if (transaction_type === "Received") {
        // Money IN -> Credit Bank
        await connection.query(
          `UPDATE banks SET account_balance = account_balance + ? WHERE id = ? AND company_id = ?`,
          [amount, bank_id, company_id]
        );

        await connection.query(
          `INSERT INTO bank_ledger
           (company_id, bank_id, type, amount, txn_date, module, reference_id, description, created_by, delete_status)
           VALUES (?, ?, 'Credit', ?, ?, 'DirectorLoan', ?, ?, ?, 0)`,
          [
            company_id,
            bank_id,
            amount,
            loan_date,
            loanId,
            `Loan Received - ${remark || ''}`,
            created_by,
          ]
        );
      } else {
        // Money OUT -> Debit Bank
        await connection.query(
          `UPDATE banks SET account_balance = account_balance - ? WHERE id = ? AND company_id = ?`,
          [amount, bank_id, company_id]
        );

        await connection.query(
          `INSERT INTO bank_ledger
           (company_id, bank_id, type, amount, txn_date, module, reference_id, description, created_by, delete_status)
           VALUES (?, ?, 'Debit', ?, ?, 'DirectorLoan', ?, ?, ?, 0)`,
          [
            company_id,
            bank_id,
            amount,
            loan_date,
            loanId,
            `Loan Given - ${remark || ''}`,
            created_by,
          ]
        );
      }
    }
    // 3. HANDLE CASH TRANSACTIONS
    else if (payment_type === "Cash") {
      if (transaction_type === "Received") {
        // Money IN -> Credit Cash
        await connection.query(
          `INSERT INTO cash_in_hand (company_id, current_balance)
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE 
             current_balance = current_balance + VALUES(current_balance),
             updated_at = NOW()`,
          [company_id, amount]
        );

        await connection.query(
          `INSERT INTO cash_ledger 
           (company_id, type, amount, txn_date, reference_type, reference_id, note, created_by, delete_status)
           VALUES (?, 'Credit', ?, ?, 'DirectorLoan', ?, ?, ?, 0)`,
          [
            company_id,
            amount,
            loan_date,
            loanId,
            `Loan Received - ${remark || ''}`,
            created_by,
          ]
        );
      } else {
        // Money OUT -> Debit Cash
        await connection.query(
          `INSERT INTO cash_in_hand (company_id, current_balance)
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE 
             current_balance = current_balance - VALUES(current_balance),
             updated_at = NOW()`,
          [company_id, amount] 
        );

        await connection.query(
          `INSERT INTO cash_ledger 
           (company_id, type, amount, txn_date, reference_type, reference_id, note, created_by, delete_status)
           VALUES (?, 'Debit', ?, ?, 'DirectorLoan', ?, ?, ?, 0)`,
          [
            company_id,
            amount,
            loan_date,
            loanId,
            `Loan Given - ${remark || ''}`,
            created_by,
          ]
        );
      }
    }

    await connection.commit();
    res.status(201).json({ success: true, msg: "Loan saved successfully" });

  } catch (err) {
    await connection.rollback();
    console.error("ADD LOAN ERROR:", err); 
    res.status(500).json({ msg: err.sqlMessage || "Server error while saving loan" });
  } finally {
    connection.release();
  }
};

/* ============================================================================
   GET LOANS
============================================================================ */
export const getDirectorLoans = async (req, res) => {
  try {
    const company_id = req.user.companyId;

    const [rows] = await db.query(
      `SELECT dl.*, 
              u.name AS director_name, 
              b.bank_name, 
              b.account_no
       FROM director_loans dl
       LEFT JOIN users u ON dl.director_id = u.id 
       LEFT JOIN banks b ON dl.bank_id = b.id
       WHERE dl.company_id = ? AND dl.delete_status = 0
       ORDER BY dl.id DESC`,
      [company_id]
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("GET LOAN ERROR:", err);
    res.status(500).json({ msg: "Server error" });
  }
};

/* ============================================================================
   GET DIRECTOR USERS
============================================================================ */
export const getDirectorUsers = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(401).json({ msg: "User authentication failed" });
    }
    const company_id = req.user.companyId;

    const [directors] = await db.query(
      `SELECT id, name, email 
       FROM users 
       WHERE company_id = ? 
       AND UPPER(role) = 'DIRECTOR'
       AND delete_status = 0`,
      [company_id]
    );

    res.json({ success: true, data: directors });
  } catch (err) {
    console.error("GET DIRECTORS ERROR:", err);
    res.status(500).json({ msg: "Server error" });
  }
};

/* ============================================================================
   DELETE LOAN
============================================================================ */
export const deleteDirectorLoan = async (req, res) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    const { id } = req.params;
    const companyId = req.user.companyId;

    // 1. Fetch Loan to ensure existence
    const [[loan]] = await connection.query(
      `SELECT payment_type FROM director_loans
       WHERE id = ? AND company_id = ? AND delete_status = 0`,
      [id, companyId]
    );

    if (!loan) {
      await connection.rollback();
      return res.status(404).json({ msg: "Loan not found or already deleted" });
    }

    // 2. Soft Delete Loan
    await connection.query(
      `UPDATE director_loans SET delete_status = 1
       WHERE id = ? AND company_id = ?`,
      [id, companyId]
    );

    // 3. Soft Delete Ledgers (Updated Logic: Try deleting both to be safe)
    
    // Attempt to delete from Cash Ledger
    await connection.query(
      `UPDATE cash_ledger SET delete_status = 1
       WHERE company_id = ? AND reference_type = 'DirectorLoan' AND reference_id = ?`,
      [companyId, id]
    );

    // Attempt to delete from Bank Ledger
    await connection.query(
      `UPDATE bank_ledger SET delete_status = 1
       WHERE company_id = ? AND module = 'DirectorLoan' AND reference_id = ?`,
      [companyId, id]
    );

    await connection.commit();
    res.json({ success: true, msg: "Loan deleted successfully" });

  } catch (err) {
    await connection.rollback();
    console.error("deleteDirectorLoan error:", err);
    res.status(500).json({ msg: "Failed to delete loan" });
  } finally {
    connection.release();
  }
};

/* ============================================================================
   GET SINGLE LOAN
============================================================================ */
export const getDirectorLoanById = async (req, res) => {
  try {
    const { id } = req.params;
    const company_id = req.user.companyId;

    const [rows] = await db.query(
      `SELECT * FROM director_loans
       WHERE id = ? AND company_id = ? AND delete_status = 0`,
      [id, company_id]
    );

    if (!rows.length) {
      return res.status(404).json({ msg: "Record not found" });
    }

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error("GET LOAN BY ID ERROR:", err);
    res.status(500).json({ msg: "Server error" });
  }
};

/* ============================================================================
   UPDATE DIRECTOR LOAN
============================================================================ */
export const updateDirectorLoan = async (req, res) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    const { id } = req.params;
    const company_id = req.user.companyId;

    const {
      loan_date,
      director_id,
      amount,
      transaction_type,
      payment_type,
      bank_id,
      remark,
    } = req.body;

    await connection.query(
      `UPDATE director_loans
       SET loan_date = ?,
           director_id = ?,
           amount = ?,
           transaction_type = ?,
           payment_type = ?,
           bank_id = ?,
           remark = ?
       WHERE id = ? AND company_id = ?`,
      [
        loan_date,
        director_id,
        amount,
        transaction_type,
        payment_type,
        bank_id || null,
        remark,
        id,
        company_id,
      ]
    );

    await connection.commit();
    res.json({ success: true, msg: "Loan updated successfully" });

  } catch (err) {
    await connection.rollback();
    console.error("UPDATE LOAN ERROR:", err);
    res.status(500).json({ msg: "Server error" });
  } finally {
    connection.release();
  }
};