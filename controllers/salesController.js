import { db } from "../config/db.js";

// -------------------------------------------------------------
//  COMMON RESPONSE HANDLER
// -------------------------------------------------------------
const respond = (res, data = null, msg = "Success", code = 200) => {
  return res.status(code).json({ msg, data });
};

// -------------------------------------------------------------
//  ADD SALE (Cash / Online / Mixed / Credit)
// -------------------------------------------------------------
export const addSale = async (req, res) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;

    // FIX: Changed to 'let' to allow reassigning invoice_number if missing
    let {
      invoice_number,
      sale_date,
      party_id,
      customer_name,
      customer_contact,
      vehicle_no,
      sub_total,
      discount_amount,
      gst_amount,
      final_amount,
      payment_type,
      cash_received = 0,
      online_received = 0,
      bank_id,
      remarks,
      items,
    } = req.body;

    // ---------------------------------------------------------
    // AUTO-GENERATE INVOICE NUMBER IF MISSING
    // ---------------------------------------------------------
    // if (!invoice_number) {
    //   const prefix = "SAL-";
    //   const [rows] = await connection.query(
    //     `SELECT invoice_number FROM sales WHERE company_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE`,
    //     [companyId]
    //   );

    //   if (rows.length === 0) {
    //     invoice_number = prefix + "00001";
    //   } else {
    //     const last = rows[0].invoice_number.replace(prefix, "");
    //     const next = String(Number(last) + 1).padStart(5, "0");
    //     invoice_number = prefix + next;
    //   }
    // }

    // ---------------------------------------------------------
    // PAYMENT LOGIC
    // ---------------------------------------------------------
    let finalCash = 0;
    let finalOnline = 0;

    if (payment_type === "Cash") {
      finalCash = Number(final_amount);
    } else if (payment_type === "Online") {
      finalOnline = Number(final_amount);
    } else if (payment_type === "Mixed") {
      finalCash = Number(cash_received);
      finalOnline = Number(online_received);
    } else if (payment_type === "Credit") {
      finalCash = 0;
      finalOnline = 0;
    }

    const total_received = finalCash + finalOnline;
    const outstanding = Number(final_amount) - total_received;

    // ---------------------------------------------------------
    // INSERT SALE
    // ---------------------------------------------------------
    const [saleResult] = await connection.query(
  `
  INSERT INTO sales
  (
    invoice_number,
    sale_date,
    party_id,
    customer_name,
    customer_contact,
    vehicle_no,
    sub_total,
    discount_amount,
    gst_amount,
    final_amount,
    cash_received,
    online_received,
    bank_id,
    amount_received,
    outstanding,
    payment_type,
    remarks,
    company_id,
    created_by,
    modified_by
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  [
    invoice_number,
    sale_date,
    party_id ?? null,
    customer_name,
    customer_contact,
    vehicle_no,
    sub_total,
    discount_amount,
    gst_amount,
    final_amount,
    finalCash,
    finalOnline,
    bank_id ?? null,
    total_received,
    outstanding,
    payment_type,
    remarks,
    companyId,
    userId,
    userId // ✅ THIS WAS MISSING
  ]
);


    const saleId = saleResult.insertId;

    // ---------------------------------------------------------
    // INSERT SALE ITEMS
    // ---------------------------------------------------------
    if (Array.isArray(items) && items.length) {
      await Promise.all(
        items.map((itm) =>
          connection.query(
            `
            INSERT INTO sale_items
            (sale_id, item_id, quantity, sale_price, line_total, company_id, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            [
              saleId,
              itm.item_id ?? null,
              itm.quantity,
              itm.sale_price,
              itm.quantity * itm.sale_price,
              companyId,
              userId,
            ]
          )
        )
      );
    }

    // ---------------------------------------------------------
    //  BANK PAYMENT HANDLING
    // ---------------------------------------------------------
    if ((payment_type === "Online" || payment_type === "Mixed") && bank_id && finalOnline > 0) {
      await connection.query(
        `UPDATE banks SET account_balance = account_balance + ? WHERE id = ? AND company_id = ?`,
        [finalOnline, bank_id, companyId]
      );

      await connection.query(
        `
        INSERT INTO bank_ledger 
        (company_id, bank_id, type, amount, txn_date, module, reference_id, description, created_by)
        VALUES (?, ?, 'Credit', ?, ?, 'Sales', ?, ?, ?)
        `,
        [
          companyId,
          bank_id,
          finalOnline,
          sale_date,
          saleId,
          `Sale ${invoice_number}`,
          userId,
        ]
      );
    }

    // ---------------------------------------------------------
    //  CASH PAYMENT HANDLING
    // ---------------------------------------------------------
    if (finalCash > 0) {
      await connection.query(
        `
        INSERT INTO cash_in_hand (company_id, current_balance)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE 
          current_balance = current_balance + VALUES(current_balance),
          updated_at = NOW()
        `,
        [companyId, finalCash]
      );

      await connection.query(
        `
        INSERT INTO cash_ledger 
        (company_id, type, amount, txn_date, reference_type, reference_id, note, created_by)
        VALUES (?, 'Credit', ?, ?, 'Sale', ?, ?, ?)
        `,
        [
          companyId,
          finalCash,
          sale_date,
          saleId,
          `Sale ${invoice_number}`,
          userId,
        ]
      );
    }

    // ---------------------------------------------------------
    //  CREDIT SALE HANDLING
    // ---------------------------------------------------------
    if (payment_type === "Credit" && outstanding > 0) {
      await connection.query(
        `
        INSERT INTO credit_ledger
        (company_id, type, party_id, amount, txn_date, reference_type, reference_id, note, created_by)
        VALUES (?, 'CustomerCredit', NULL, ?, ?, 'Sale', ?, ?, ?)
        `,
        [
          companyId,
          outstanding,
          sale_date,
          saleId,
          `Sale ${invoice_number} | Customer: ${customer_name}`,
          userId,
        ]
      );
    }

    // ---------------------------------------------------------
    // COMMIT
    // ---------------------------------------------------------
    await connection.commit();
    respond(res, { id: saleId, invoice_number }, "Sale Created", 201);

  } catch (err) {
    await connection.rollback();
    console.error("addSale error:", err);
    return res.status(500).json({ msg: err.message });
  } finally {
    connection.release();
  }
};

// -------------------------------------------------------------
//  GET SALES (LATEST ON TOP)
// -------------------------------------------------------------
export const getSales = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    let page = Number(req.query.page) || 1;
    let limit = Number(req.query.limit) || 10;
    let offset = (page - 1) * limit;

    const [rows] = await db.query(
      `
      SELECT
        sales.id,
        invoice_number,
        DATE_FORMAT(sale_date, '%d-%m-%Y') AS sale_date,
        customer_name,
        customer_contact,
        final_amount,
        cash_received,
        online_received,
        outstanding,
        users.name as created_by_name
      FROM sales
      LEFT JOIN users on sales.created_by = users.id
      WHERE sales.company_id = ? AND sales.delete_status = 0
      ORDER BY sales.id DESC
      LIMIT ? OFFSET ?
      `,
      [companyId, limit, offset]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM sales WHERE company_id = ? AND delete_status = 0`,
      [companyId]
    );

    res.json({ msg: "Success", data: rows, total, page, limit });

  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// -------------------------------------------------------------
//  GET SINGLE SALE WITH ITEMS
// -------------------------------------------------------------
export const getSaleById = async (req, res) => {
  try {
    const saleId = req.params.id;
    const companyId = req.user.companyId;

    const query = `
      SELECT 
        s.*, 
        c.name AS company_name,
        c.address AS company_address,
        c.contact AS company_contact,
        c.gstin AS company_gstin,
        u.name AS created_by_user,

        JSON_ARRAYAGG(
          JSON_OBJECT(
            'item_id', si.item_id,
            'quantity', si.quantity,
            'sale_price', si.sale_price,
            'line_total', si.line_total,
            'itemName', i.itemName,
            'unit', i.unit
          )
        ) AS items

      FROM sales s
      LEFT JOIN company c ON s.company_id = c.id
      LEFT JOIN users u ON s.created_by = u.id
      LEFT JOIN sale_items si ON s.id = si.sale_id
      LEFT JOIN items i ON si.item_id = i.id

      WHERE s.id = ? AND s.company_id = ?
      GROUP BY s.id
    `;

    const [rows] = await db.query(query, [saleId, companyId]);

    if (!rows.length) return res.status(404).json({ msg: "Sale not found" });

    return respond(res, rows[0]);

  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// -------------------------------------------------------------
//  GET NEXT INVOICE NUMBER
// -------------------------------------------------------------
// export const getNextInvoice = async (req, res) => {
//   try {
//     const companyId = req.user.companyId;
//     const prefix = "SAL-";

//     const [rows] = await db.query(
//       `
//       SELECT invoice_number 
//       FROM sales 
//       WHERE company_id = ?
//       ORDER BY id DESC 
//       LIMIT 1
//       `,
//       [companyId]
//     );

//     if (rows.length === 0)
//       return res.json({ msg: "Success", data: prefix + "00001" });

//     const last = rows[0].invoice_number.replace(prefix, "");
//     const next = String(Number(last) + 1).padStart(5, "0");

//     res.json({ msg: "Success", data: prefix + next });

//   } catch (err) {
//     res.status(500).json({ msg: "Server error" });
//   }
// };

// -------------------------------------------------------------
//  UPDATE SALE
// -------------------------------------------------------------
export const updateSale = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;

    const {
      customer_name,
      customer_contact,
      vehicle_no,
      payment_type,
      cash_received,
      online_received,
      outstanding,
      remarks,
    } = req.body;

    const [result] = await db.query(
      `
      UPDATE sales
      SET
        customer_name = ?,
        customer_contact = ?,
        vehicle_no = ?,
        payment_type = ?,
        cash_received = ?,
        online_received = ?,
        outstanding = ?,
        remarks = ?
      WHERE id = ? AND company_id = ? AND delete_status = 0
      `,
      [
        customer_name,
        customer_contact,
        vehicle_no,
        payment_type,
        cash_received,
        online_received,
        outstanding,
        remarks,
        id,
        companyId,
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ msg: "Sale not found" });
    }

    res.json({ msg: "Sale updated successfully" });

  } catch (err) {
    console.error("updateSale error:", err);
    res.status(500).json({ msg: err.message });
  }
};

// -------------------------------------------------------------
//  DELETE SALE
// -------------------------------------------------------------
export const deleteSale = async (req, res) => {
  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    const saleId = req.params.id;
    const companyId = req.user.companyId;

    /* 1️⃣ Fetch sale financial snapshot */
    const [[sale]] = await conn.query(
      `
      SELECT 
        payment_type,
        cash_received,
        online_received,
        outstanding,
        bank_id
      FROM sales
      WHERE id = ? AND company_id = ? AND delete_status = 0
      `,
      [saleId, companyId]
    );

    if (!sale) {
      await conn.rollback();
      return res.status(404).json({ msg: "Sale not found or already deleted" });
    }

    /* 2️⃣ Soft delete SALE */
    await conn.query(
      `
      UPDATE sales 
      SET delete_status = 1 
      WHERE id = ? AND company_id = ?
      `,
      [saleId, companyId]
    );

    /* 3️⃣ CASH REVERSAL */
    if (sale.cash_received > 0) {
      await conn.query(
        `
        UPDATE cash_in_hand
        SET current_balance = current_balance - ?
        WHERE company_id = ?
        `,
        [sale.cash_received, companyId]
      );

      await conn.query(
        `
        UPDATE cash_ledger
        SET delete_status = 1
        WHERE reference_type = 'Sale'
          AND reference_id = ?
          AND company_id = ?
        `,
        [saleId, companyId]
      );
    }

    /* 4️⃣ BANK REVERSAL */
    if (sale.online_received > 0 && sale.bank_id) {
      await conn.query(
        `
        UPDATE banks
        SET account_balance = account_balance - ?
        WHERE id = ? AND company_id = ?
        `,
        [sale.online_received, sale.bank_id, companyId]
      );

      await conn.query(
        `
        UPDATE bank_ledger
        SET delete_status = 1
        WHERE module IN ('Sales', 'Sale') 
          AND reference_id = ?
          AND company_id = ?
        `,
        [saleId, companyId]
      );
    }

    /* 5️⃣ CREDIT LEDGER REVERSAL */
    if (sale.outstanding > 0) {
      await conn.query(
        `
        UPDATE credit_ledger
        SET delete_status = 1
        WHERE reference_type = 'Sale'
          AND reference_id = ?
          AND company_id = ?
        `,
        [saleId, companyId]
      );
    }

    await conn.commit();
    res.json({ msg: "Sale and all related ledgers deleted successfully" });

  } catch (err) {
    await conn.rollback();
    console.error("deleteSale ERROR:", err);
    res.status(500).json({ msg: "Sale delete failed" });
  } finally {
    conn.release();
  }
};
