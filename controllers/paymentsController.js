
import { db } from "../config/db.js";

const respond = (res, data = null, msg = "Success", status = 200) =>
  res.status(status).json({ msg, data });

/* =========================
   CUSTOMER OUTSTANDING
========================= */
export const getSalesOutstanding = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const sql = `
      SELECT
        party_id,
        customer_name,
        customer_contact,
        SUM(final_amount) AS total_sale,
        SUM(outstanding) AS outstanding
      FROM sales
      WHERE company_id = ?
        AND delete_status = 0
      GROUP BY party_id, customer_name, customer_contact
      HAVING outstanding > 0
      ORDER BY outstanding DESC
    `;

    const [rows] = await db.query(sql, [companyId]);
    respond(res, rows);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/* =========================
   RECEIVE CUSTOMER PAYMENT
========================= */
export const receivePayment = async (req, res) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    const {
      party_id,
      customer_name,
      customer_contact,
      amount,
      payment_type,
      bank_id
    } = req.body;

    const companyId = req.user.companyId;
    const userId = req.user.id;
    const receivedAmount = Number(amount);

    let sql = `
      SELECT id, outstanding
      FROM sales
      WHERE company_id = ?
        AND delete_status = 0
        AND outstanding > 0
    `;
    const params = [companyId];

    if (party_id) {
      sql += ` AND party_id = ?`;
      params.push(party_id);
    } else {
      sql += ` AND customer_name = ? AND customer_contact = ?`;
      params.push(customer_name, customer_contact);
    }

    sql += ` ORDER BY sale_date ASC, id ASC`;

    const [sales] = await connection.query(sql, params);

    let remaining = receivedAmount;

    for (const s of sales) {
      if (remaining <= 0) break;

      const pay = Math.min(remaining, Number(s.outstanding));
      remaining -= pay;

      await connection.query(
        `UPDATE sales SET outstanding = outstanding - ? WHERE id = ?`,
        [pay, s.id]
      );
    }

    const [paymentRes] = await connection.query(
      `
      INSERT INTO customer_payments
        (party_id, customer_name, customer_contact, amount, payment_type, bank_id,
         company_id, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `,
      [
        party_id || null,
        customer_name,
        customer_contact,
        receivedAmount,
        payment_type,
        payment_type === "Online" ? bank_id : null,
        companyId,
        userId
      ]
    );

    const paymentId = paymentRes.insertId;

    if (payment_type === "Cash") {
      await connection.query(
        `
        INSERT INTO cash_in_hand (company_id, current_balance)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE current_balance = current_balance + ?
        `,
        [companyId, receivedAmount, receivedAmount]
      );

      await connection.query(
        `
        INSERT INTO cash_ledger
          (company_id, type, amount, txn_date, reference_type, reference_id, note, created_by, delete_status)
        VALUES (?, 'Credit', ?, NOW(), 'CustomerPayment', ?, ?, ?, 0)
        `,
        [companyId, receivedAmount, paymentId, `Received from ${customer_name}`, userId]
      );
    }

    if (payment_type === "Online" && bank_id) {
      await connection.query(
        `UPDATE banks SET account_balance = account_balance + ? WHERE id = ?`,
        [receivedAmount, bank_id]
      );

      await connection.query(
        `
        INSERT INTO bank_ledger
          (company_id, bank_id, type, amount, txn_date, module, reference_id, description, created_by, delete_status)
        VALUES (?, ?, 'Credit', ?, NOW(), 'CustomerPayment', ?, ?, ?, 0)
        `,
        [companyId, bank_id, receivedAmount, paymentId, `Received from ${customer_name}`, userId]
      );
    }

    await connection.commit();
    respond(res, null, "Payment Received");
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ msg: err.message });
  } finally {
    connection.release();
  }
};

/* =========================
   SUPPLIER OUTSTANDING
========================= */
export const getPurchaseOutstanding = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const sql = `
      SELECT
        supplier_id,
        supplier_name,
        supplier_contact,
        SUM(final_amount) AS total_purchase,
        SUM(outstanding) AS outstanding
      FROM purchases
      WHERE company_id = ?
        AND delete_status = 0
      GROUP BY supplier_id, supplier_name, supplier_contact
      HAVING outstanding > 0
      ORDER BY outstanding DESC
    `;

    const [rows] = await db.query(sql, [companyId]);
    respond(res, rows);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

/* =========================
   PAY SUPPLIER
========================= */
export const receivePurchasePayment = async (req, res) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    const {
      supplier_id,
      supplier_name,
      supplier_contact,
      amount,
      payment_type,
      bank_id
    } = req.body;

    const companyId = req.user.companyId;
    const userId = req.user.id;
    const paidAmount = Number(amount);

    let sql = `
      SELECT id, outstanding
      FROM purchases
      WHERE company_id = ?
        AND delete_status = 0
        AND outstanding > 0
    `;
    const params = [companyId];

    if (supplier_id) {
      sql += ` AND supplier_id = ?`;
      params.push(supplier_id);
    } else {
      sql += ` AND supplier_name = ? AND supplier_contact = ?`;
      params.push(supplier_name, supplier_contact);
    }

    sql += ` ORDER BY purchase_date ASC, id ASC`;

    const [rows] = await connection.query(sql, params);

    let remaining = paidAmount;

    for (const r of rows) {
      if (remaining <= 0) break;

      const pay = Math.min(remaining, Number(r.outstanding));
      remaining -= pay;

      await connection.query(
        `UPDATE purchases SET outstanding = outstanding - ? WHERE id = ?`,
        [pay, r.id]
      );
    }

    await connection.query(
      `
      INSERT INTO supplier_payments
        (supplier_id, supplier_name, supplier_contact, amount, payment_type, bank_id,
         company_id, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `,
      [
        supplier_id || null,
        supplier_name,
        supplier_contact,
        paidAmount,
        payment_type,
        payment_type === "Online" ? bank_id : null,
        companyId,
        userId
      ]
    );

    if (payment_type === "Cash") {
      await connection.query(
        `UPDATE cash_in_hand SET current_balance = current_balance - ? WHERE company_id = ?`,
        [paidAmount, companyId]
      );
    }

    if (payment_type === "Online" && bank_id) {
      await connection.query(
        `UPDATE banks SET account_balance = account_balance - ? WHERE id = ?`,
        [paidAmount, bank_id]
      );
    }

    await connection.commit();
    respond(res, null, "Payment Paid");
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ msg: err.message });
  } finally {
    connection.release();
  }
};
export const getPaymentHistory = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { type } = req.query; // customer | supplier

    let sql = "";

    if (type === "customer") {
      sql = `
        SELECT
          id,
          party_id,
          customer_name AS party,
          amount,
          payment_type,
          created_at AS txn_date,
          'Received' AS txn_type
        FROM customer_payments
        WHERE company_id = ?
        ORDER BY id DESC
        LIMIT 50
      `;
    } else {
      sql = `
        SELECT
          id,
          supplier_id AS party_id,
          supplier_name AS party,
          amount,
          payment_type,
          created_at AS txn_date,
          'Paid' AS txn_type
        FROM supplier_payments
        WHERE company_id = ?
        ORDER BY id DESC
        LIMIT 50
      `;
    }

    const [rows] = await db.query(sql, [companyId]);
    respond(res, rows);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};
