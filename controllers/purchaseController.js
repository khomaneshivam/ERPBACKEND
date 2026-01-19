import { db } from "../config/db.js";

const respond = (res, data = null, msg = "Success", code = 200) =>
  res.status(code === 201 ? 201 : code).json({ msg, data });

/* ============================================================================
   ADD PURCHASE  (Supports: Cash / Online / Mixed / Credit)
============================================================================ */
export const addPurchase = async (req, res) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;

    const {
      purchase_number,
      purchase_date,        // used as ledger txn_date
      supplier_id,
      supplier_name,
      supplier_contact,
      supplier_address,
      vehicle_no,
      sub_total,
      discount_amount,
      gst_amount,
      final_amount,
      cash_paid = 0,
      online_paid = 0,
      bank_id = null,
      payment_type,         // Cash | Online | Mixed | Credit
      remarks,
      items = []
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return respond(res, null, "At least one item is required", 400);
    }

    const amount_paid = Number(cash_paid) + Number(online_paid);
    const outstanding = Number(final_amount) - amount_paid;

    /* ---------------------------------------------------------
        INSERT PURCHASE HEADER
    --------------------------------------------------------- */
    const [pResult] = await connection.query(
      `
      INSERT INTO purchases (
        purchase_number, purchase_date,
        supplier_id, supplier_name, supplier_contact, supplier_address,
        vehicle_no, sub_total, discount_amount, gst_amount, final_amount,
        cash_paid, online_paid, bank_id, amount_paid, outstanding,
        payment_type, remarks,
        company_id, created_by, modified_by, delete_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        purchase_number,
        purchase_date,
        supplier_id || null,
        supplier_name,
        supplier_contact,
        supplier_address,
        vehicle_no,
        sub_total,
        discount_amount,
        gst_amount,
        final_amount,
        cash_paid,
        online_paid,
        bank_id,
        amount_paid,
        outstanding,
        payment_type,
        remarks,
        companyId, // company_id
        userId,    // created_by
        userId,    // modified_by
        0          // delete_status (Explicitly 0)
      ]
    );

    const purchaseId = pResult.insertId;

    /* ---------------------------------------------------------
        INSERT PURCHASE ITEMS
    --------------------------------------------------------- */
    for (const it of items) {
      await connection.query(
        `
        INSERT INTO purchase_items 
        (purchase_id, item_id, item_name, unit, quantity, purchase_price, line_total, company_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          purchaseId,
          it.item_id || null,
          it.item_name || it.itemName,
          it.unit,
          it.quantity,
          it.purchase_price,
          it.quantity * it.purchase_price,
          companyId,
          userId
        ]
      );
    }

    /* ============================================================================
       CREDIT PURCHASE LOGIC (SupplierCredit Ledger)
    ============================================================================ */
    if (payment_type === "Credit") {
      await connection.query(
        `
        INSERT INTO credit_ledger
        (company_id, type, party_id, amount, txn_date, reference_type, reference_id, note, created_by, delete_status)
        VALUES (?, 'SupplierCredit', ?, ?, ?, 'Purchase', ?, ?, ?, 0)
        `,
        [
          companyId,
          supplier_id || null,
          final_amount,
          purchase_date,
          purchaseId,
          `Purchase #${purchase_number}`,
          userId
        ]
      );
    }

    /* ============================================================================
       BANK PAYMENT LOGIC (Online)
    ============================================================================ */
    if ((payment_type === "Online" || payment_type === "Mixed") && online_paid > 0 && bank_id) {
      // Deduct bank balance
      await connection.query(
        `
        UPDATE banks 
        SET account_balance = account_balance - ?
        WHERE id = ? AND company_id = ?
        `,
        [online_paid, bank_id, companyId]
      );

      // Add ledger entry
      await connection.query(
        `
        INSERT INTO bank_ledger 
        (company_id, bank_id, type, amount, txn_date, module, reference_id, description, created_by, delete_status)
        VALUES (?, ?, 'Debit', ?, ?, 'Purchase', ?, ?, ?, 0)
        `,
        [
          companyId,
          bank_id,
          online_paid,
          purchase_date,
          purchaseId,
          `Purchase ${purchase_number}`,
          userId
        ]
      );
    }

    /* ============================================================================
       CASH PAYMENT LOGIC
    ============================================================================ */
    if (cash_paid > 0) {
      // Reduce cash in hand
      await connection.query(
        `
        INSERT INTO cash_in_hand (company_id, current_balance)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE 
          current_balance = current_balance - VALUES(current_balance),
          updated_at = NOW()
        `,
        [companyId, cash_paid]
      );

      // Ledger entry (Debit)
      await connection.query(
        `
        INSERT INTO cash_ledger 
        (company_id, type, amount, txn_date, reference_type, reference_id, note, created_by, delete_status)
        VALUES (?, 'Debit', ?, ?, 'Purchase', ?, ?, ?, 0)
        `,
        [
          companyId,
          cash_paid,
          purchase_date,
          purchaseId,
          `Purchase ${purchase_number}`,
          userId
        ]
      );
    }

    await connection.commit();
    return respond(res, { purchaseId }, "Purchase Added Successfully", 201);

  } catch (err) {
    await connection.rollback();
    console.error("ADD PURCHASE ERROR:", err);
    return respond(res, null, err.message, 500);
  } finally {
    connection.release();
  }
};

/* -----------------------------------------------------
    GET PURCHASE LIST
----------------------------------------------------- */
export const getPurchases = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    // Count total rows
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total
       FROM purchases
       WHERE company_id = ? AND delete_status = 0`,
      [companyId]
    );

    // Fetch records
    const [rows] = await db.query(
      `SELECT 
        purchases.id, 
        purchase_number, 
        DATE_FORMAT(purchase_date, '%d-%m-%Y') AS purchase_date,
        purchase_date AS purchase_date_raw,
        supplier_name,
        supplier_contact,
        final_amount,
        cash_paid,
        online_paid,
        outstanding,
        payment_type,
        users.name as created_by_name 
       FROM purchases
       LEFT JOIN users on purchases.created_by = users.id
       WHERE purchases.company_id = ? AND purchases.delete_status = 0
       ORDER BY purchase_date_raw DESC, purchases.id DESC
       LIMIT ? OFFSET ?`,
      [companyId, limit, offset]
    );

    return res.json({
      msg: "Success",
      data: rows,
      total,
      page,
      limit
    });

  } catch (err) {
    console.error("getPurchases error:", err);
    return res.status(500).json({ msg: err.message });
  }
};

/* ============================================================================
   GET PURCHASE BY ID (with items)
============================================================================ */
export const getPurchaseById = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const purchaseId = req.params.id;

    const query = `
      SELECT 
        p.id,
        p.purchase_number,
        DATE_FORMAT(p.purchase_date, '%d-%m-%Y') AS purchase_date,
        p.supplier_name,
        p.supplier_contact,
        p.supplier_address,
        p.vehicle_no,
        p.sub_total,
        p.discount_amount,
        p.gst_amount,
        p.final_amount,
        p.cash_paid,
        p.online_paid,
        p.amount_paid,
        p.outstanding,
        p.payment_type,
        p.remarks,
        p.bank_id,

        c.name AS company_name,
        c.address AS company_address,
        c.contact AS company_contact,
        c.gstin AS company_gstin,

        JSON_ARRAYAGG(
          JSON_OBJECT(
            'item_id', pi.item_id,
            'item_name', pi.item_name,
            'unit', pi.unit,
            'quantity', pi.quantity,
            'purchase_price', pi.purchase_price,
            'line_total', pi.line_total
          )
        ) AS items

      FROM purchases p
      LEFT JOIN company c ON p.company_id = c.id
      LEFT JOIN purchase_items pi ON p.id = pi.purchase_id
      WHERE p.id = ? AND p.company_id = ?
      GROUP BY p.id
    `;

    const [rows] = await db.query(query, [purchaseId, companyId]);

    if (!rows.length) return respond(res, null, "Purchase Not Found", 404);

    return respond(res, rows[0]);

  } catch (err) {
    return respond(res, null, err.message, 500);
  }
};

/* ============================================================================
   UPDATE PURCHASE
============================================================================ */
export const updatePurchase = async (req, res) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    const { id } = req.params;
    const companyId = req.user.companyId;
    const { items, ...data } = req.body;

    await connection.query(
      `
      UPDATE purchases SET
        purchase_number=?,
        purchase_date=?,
        supplier_id=?,
        supplier_name=?,
        supplier_contact=?,
        supplier_address=?,
        vehicle_no=?,
        sub_total=?,
        discount_amount=?,
        gst_amount=?,
        final_amount=?,
        cash_paid=?,
        online_paid=?,
        amount_paid=?,
        outstanding=?,
        bank_id=?,
        payment_type=?,
        remarks=?
      WHERE id=? AND company_id=?
      `,
      [
        data.purchase_number,
        data.purchase_date,
        data.supplier_id,
        data.supplier_name,
        data.supplier_contact,
        data.supplier_address,
        data.vehicle_no,
        data.sub_total,
        data.discount_amount,
        data.gst_amount,
        data.final_amount,
        data.cash_paid,
        data.online_paid,
        data.amount_paid,
        data.outstanding,
        data.bank_id,
        data.payment_type,
        data.remarks,
        id,
        companyId,
      ]
    );

    // Replace items
    await connection.query(
      "DELETE FROM purchase_items WHERE purchase_id=? AND company_id=?",
      [id, companyId]
    );

    for (const it of items) {
      await connection.query(
        `
        INSERT INTO purchase_items
        (purchase_id, item_id, item_name, unit, quantity, purchase_price, line_total, company_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          id,
          it.item_id,
          it.item_name,
          it.unit,
          it.quantity,
          it.purchase_price,
          it.quantity * it.purchase_price,
          companyId,
          req.user.id
        ]
      );
    }

    await connection.commit();
    res.json({ msg: "Purchase updated" });

  } catch (err) {
    await connection.rollback();
    console.error("updatePurchase error:", err);
    res.status(500).json({ msg: "Failed to update purchase" });
  } finally {
    connection.release();
  }
};

/* ============================================================================
   DELETE PURCHASE
============================================================================ */
export const deletePurchase = async (req, res) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    const { id } = req.params;
    const companyId = req.user.companyId;

    /* --------------------------------------------------
       1️⃣ FETCH PURCHASE (to know payment_type)
    -------------------------------------------------- */
    const [[purchase]] = await connection.query(
      `
      SELECT payment_type
      FROM purchases
      WHERE id = ? AND company_id = ? AND delete_status = 0
      `,
      [id, companyId]
    );

    if (!purchase) {
      await connection.rollback();
      return res.status(404).json({ msg: "Purchase not found or already deleted" });
    }

    const paymentType = purchase.payment_type;

    /* --------------------------------------------------
       2️⃣ SOFT DELETE PURCHASE
    -------------------------------------------------- */
    await connection.query(
      `
      UPDATE purchases
      SET delete_status = 1
      WHERE id = ? AND company_id = ?
      `,
      [id, companyId]
    );

    /* --------------------------------------------------
       3️⃣ SOFT DELETE LEDGERS (BY PAYMENT TYPE)
    -------------------------------------------------- */

    // 🔹 CASH LEDGER
    if (paymentType === "Cash" || paymentType === "Mixed") {
      await connection.query(
        `
        UPDATE cash_ledger
        SET delete_status = 1
        WHERE company_id = ?
          AND reference_type = 'Purchase'
          AND reference_id = ?
          AND delete_status = 0
        `,
        [companyId, id]
      );
    }

    // 🔹 BANK LEDGER
    if (paymentType === "Online" || paymentType === "Mixed") {
      await connection.query(
        `
        UPDATE bank_ledger
        SET delete_status = 1
        WHERE company_id = ?
          AND module = 'Purchase'
          AND reference_id = ?
          AND delete_status = 0
        `,
        [companyId, id]
      );
    }

    // 🔹 CREDIT LEDGER
    if (paymentType === "Credit") {
      await connection.query(
        `
        UPDATE credit_ledger
        SET delete_status = 1
        WHERE company_id = ?
          AND reference_type = 'Purchase'
          AND reference_id = ?
          AND delete_status = 0
        `,
        [companyId, id]
      );
    }

    /* --------------------------------------------------
       4️⃣ COMMIT
    -------------------------------------------------- */
    await connection.commit();
    res.json({ msg: "Purchase deleted successfully" });

  } catch (err) {
    await connection.rollback();
    console.error("deletePurchase error:", err);
    res.status(500).json({ msg: "Failed to delete purchase" });
  } finally {
    connection.release();
  }
};
