import { db } from "../config/db.js";

/* ============================================================================
   ADD EXPENSE
============================================================================ */
export const addExpense = async (req, res) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;

    const {
      expense_name,
      expense_category,
      amount,
      expense_date,
      payment_type,
      vendor_name,
      invoice_number,
      remarks,
      bank_id,
    } = req.body;

    const expenseAmount = Number(amount);

    // 1. Insert Expense
    const [result] = await connection.query(
      `INSERT INTO expenses 
       (expense_name, expense_category, amount, expense_date, payment_type, vendor_name, invoice_number, remarks, bank_id, company_id, created_by, delete_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        expense_name,
        expense_category,
        expenseAmount,
        expense_date,
        payment_type,
        vendor_name || null,
        invoice_number || null,
        remarks || null,
        bank_id || null,
        companyId,
        userId,
      ]
    );

    const expenseId = result.insertId;

    // 2. Ledgers (Debit)
    if (payment_type === "Cash") {
      await connection.query(
        `INSERT INTO cash_in_hand (company_id, current_balance) VALUES (?, ?) 
         ON DUPLICATE KEY UPDATE current_balance = current_balance - VALUES(current_balance), updated_at = NOW()`,
        [companyId, expenseAmount]
      );
      await connection.query(
        `INSERT INTO cash_ledger 
         (company_id, type, amount, txn_date, reference_type, reference_id, note, created_by, delete_status) 
         VALUES (?, 'Debit', ?, ?, 'Expense', ?, ?, ?, 0)`,
        [companyId, expenseAmount, expense_date, expenseId, `Expense: ${expense_name}`, userId]
      );
    }
    else if (payment_type === "Online" && bank_id) {
      await connection.query(
        `UPDATE banks SET account_balance = account_balance - ? WHERE id = ? AND company_id = ?`,
        [expenseAmount, bank_id, companyId]
      );
      await connection.query(
        `INSERT INTO bank_ledger 
         (company_id, bank_id, type, amount, txn_date, module, reference_id, description, created_by, delete_status) 
         VALUES (?, ?, 'Debit', ?, ?, 'Expense', ?, ?, ?, 0)`,
        [companyId, bank_id, expenseAmount, expense_date, expenseId, `Expense: ${expense_name}`, userId]
      );
    }
    else if (payment_type === "Credit") {
      await connection.query(
        `INSERT INTO credit_ledger 
         (company_id, type, amount, txn_date, reference_type, reference_id, note, created_by, delete_status) 
         VALUES (?, 'ExpenseCredit', ?, ?, 'Expense', ?, ?, ?, 0)`,
        [companyId, expenseAmount, expense_date, expenseId, `Expense: ${expense_name}`, userId]
      );
    }

    await connection.commit();
    res.status(201).json({ msg: "Expense added successfully", id: expenseId });

  } catch (err) {
    await connection.rollback();
    console.error("addExpense Error:", err);
    res.status(500).json({ msg: "Failed to add expense" });
  } finally {
    connection.release();
  }
};

/* ============================================================================
   GET EXPENSES
============================================================================ */
export const getExpenses = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const page = Number(req.query.page) || 0;
    const limit = Number(req.query.limit) || 10;
    const offset = page * limit;

    const [[{ total }]] = await db.query(
      "SELECT COUNT(*) as total FROM expenses WHERE company_id = ? AND delete_status = 0",
      [companyId]
    );

    const [records] = await db.query(
      `SELECT 
  e.*,
  DATE_FORMAT(e.expense_date, '%Y-%m-%d') AS expense_date,
  b.bank_name,
  u.name AS created_by_name
FROM expenses e
LEFT JOIN banks b 
  ON e.bank_id = b.id
LEFT JOIN users u 
  ON e.created_by = u.id
WHERE e.company_id = ?
  AND e.delete_status = 0
ORDER BY e.expense_date DESC, e.id DESC
LIMIT ? OFFSET ?;
`,
      [companyId, limit, offset]
    );

    res.json({ msg: "Success", data: { records, total, page, limit } });
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
};

/* ============================================================================
   GET EXPENSE BY ID
============================================================================ */
export const getExpenseById = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;
    const [rows] = await db.query(
      `SELECT *, DATE_FORMAT(expense_date, '%Y-%m-%d') as expense_date 
       FROM expenses WHERE id = ? AND company_id = ? AND delete_status = 0`,
      [id, companyId]
    );
    if (!rows.length) return res.status(404).json({ msg: "Expense not found" });
    res.json({ msg: "Success", data: rows[0] });
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
};

/* ============================================================================
   UPDATE EXPENSE (Full Logic: Reverse Old -> Apply New)
============================================================================ */
export const updateExpense = async (req, res) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    const companyId = req.user.companyId;
    const userId = req.user.id;
    const { id } = req.params;

    const {
      expense_name,
      expense_category,
      amount,
      expense_date,
      payment_type,
      vendor_name,
      invoice_number,
      remarks,
      bank_id
    } = req.body;

    const newAmount = Number(amount);

    // 1. Fetch Old Data (Lock Row)
    const [[oldExp]] = await connection.query(
      `SELECT * FROM expenses WHERE id = ? AND company_id = ? FOR UPDATE`,
      [id, companyId]
    );

    if (!oldExp) {
      await connection.rollback();
      return res.status(404).json({ msg: "Expense not found" });
    }

    // 2. REVERSE OLD TRANSACTION (Credit back money)
    const oldAmount = Number(oldExp.amount);
    
    if (oldExp.payment_type === "Cash") {
      await connection.query(
        `UPDATE cash_in_hand SET current_balance = current_balance + ? WHERE company_id = ?`,
        [oldAmount, companyId]
      );
      // Remove old cash ledger entry for this expense
      await connection.query(
        `DELETE FROM cash_ledger WHERE reference_type = 'Expense' AND reference_id = ?`,
        [id]
      );
    } 
    else if (oldExp.payment_type === "Online" && oldExp.bank_id) {
      await connection.query(
        `UPDATE banks SET account_balance = account_balance + ? WHERE id = ?`,
        [oldAmount, oldExp.bank_id]
      );
      // Remove old bank ledger entry
      await connection.query(
        `DELETE FROM bank_ledger WHERE module = 'Expense' AND reference_id = ?`,
        [id]
      );
    }
    else if (oldExp.payment_type === "Credit") {
       // Remove old credit ledger entry
       await connection.query(
        `DELETE FROM credit_ledger WHERE reference_type = 'Expense' AND reference_id = ?`,
        [id]
      );
    }

    // 3. UPDATE EXPENSE TABLE
    await connection.query(
      `UPDATE expenses 
       SET expense_name=?, expense_category=?, amount=?, expense_date=?, 
           payment_type=?, vendor_name=?, invoice_number=?, remarks=?, bank_id=?
       WHERE id=? AND company_id=?`,
      [
        expense_name,
        expense_category,
        newAmount,
        expense_date,
        payment_type,
        vendor_name,
        invoice_number,
        remarks,
        bank_id || null,
        id,
        companyId
      ]
    );

    // 4. APPLY NEW TRANSACTION (Debit new amount)
    if (payment_type === "Cash") {
      await connection.query(
        `UPDATE cash_in_hand SET current_balance = current_balance - ? WHERE company_id = ?`,
        [newAmount, companyId]
      );
      await connection.query(
        `INSERT INTO cash_ledger 
         (company_id, type, amount, txn_date, reference_type, reference_id, note, created_by, delete_status) 
         VALUES (?, 'Debit', ?, ?, 'Expense', ?, ?, ?, 0)`,
        [companyId, newAmount, expense_date, id, `Expense: ${expense_name}`, userId]
      );
    }
    else if (payment_type === "Online" && bank_id) {
      await connection.query(
        `UPDATE banks SET account_balance = account_balance - ? WHERE id = ?`,
        [newAmount, bank_id]
      );
      await connection.query(
        `INSERT INTO bank_ledger 
         (company_id, bank_id, type, amount, txn_date, module, reference_id, description, created_by, delete_status) 
         VALUES (?, ?, 'Debit', ?, ?, 'Expense', ?, ?, ?, 0)`,
        [companyId, bank_id, newAmount, expense_date, id, `Expense: ${expense_name}`, userId]
      );
    }
    else if (payment_type === "Credit") {
      await connection.query(
        `INSERT INTO credit_ledger 
         (company_id, type, amount, txn_date, reference_type, reference_id, note, created_by, delete_status) 
         VALUES (?, 'ExpenseCredit', ?, ?, 'Expense', ?, ?, ?, 0)`,
        [companyId, newAmount, expense_date, id, `Expense: ${expense_name}`, userId]
      );
    }

    await connection.commit();
    res.json({ msg: "Expense updated successfully" });

  } catch (err) {
    await connection.rollback();
    console.error("updateExpense Error:", err);
    res.status(500).json({ msg: "Failed to update expense" });
  } finally {
    connection.release();
  }
};

/* ============================================================================
   DELETE EXPENSE
============================================================================ */
export const deleteExpense = async (req, res) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    const { id } = req.params;
    const companyId = req.user.companyId;

    // 1. Fetch Expense
    const [[expense]] = await connection.query(
      `SELECT payment_type, amount, bank_id FROM expenses 
       WHERE id = ? AND company_id = ? AND delete_status = 0`,
      [id, companyId]
    );

    if (!expense) {
      await connection.rollback();
      return res.status(404).json({ msg: "Expense not found" });
    }

    // 2. Soft Delete Expense
    await connection.query(
      `UPDATE expenses SET delete_status = 1 WHERE id = ?`,
      [id]
    );

    // 3. Soft Delete Ledgers
    // Note: We keep the financial impact (balance deduction) unless you want to REVERSE it.
    // Usually, deleting an expense implies it was a mistake, so we SHOULD reverse the money.
    // Let's reverse the money AND soft-delete the ledger.

    const amt = Number(expense.amount);

    if (expense.payment_type === "Cash") {
      // Refund Cash
      await connection.query(
        `UPDATE cash_in_hand SET current_balance = current_balance + ? WHERE company_id = ?`,
        [amt, companyId]
      );
      // Hide Ledger
      await connection.query(
        `UPDATE cash_ledger SET delete_status = 1 WHERE reference_type='Expense' AND reference_id=?`,
        [id]
      );
    } 
    else if (expense.payment_type === "Online" && expense.bank_id) {
      // Refund Bank
      await connection.query(
        `UPDATE banks SET account_balance = account_balance + ? WHERE id = ?`,
        [amt, expense.bank_id]
      );
      // Hide Ledger
      await connection.query(
        `UPDATE bank_ledger SET delete_status = 1 WHERE module='Expense' AND reference_id=?`,
        [id]
      );
    }
    else if (expense.payment_type === "Credit") {
      // Hide Ledger
      await connection.query(
        `UPDATE credit_ledger SET delete_status = 1 WHERE reference_type='Expense' AND reference_id=?`,
        [id]
      );
    }

    await connection.commit();
    res.json({ msg: "Expense deleted successfully" });

  } catch (err) {
    await connection.rollback();
    console.error("deleteExpense Error:", err);
    res.status(500).json({ msg: "Failed to delete expense" });
  } finally {
    connection.release();
  }
};