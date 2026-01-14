import { db } from "../config/db.js";

const respond = (res, data = null, msg = "Success", status = 200) =>
  res.status(status).json({ msg, data });


// -------------------------------------------------
//  GET BILL / PRINT BILL (FROM SALES)
// -------------------------------------------------
export const getBillById = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const saleId = req.params.id;

    const query = `
      SELECT 
        s.id,
        s.invoice_number AS bill_number,

        -- 🟩 formatted date for UI
        DATE_FORMAT(s.sale_date, '%d-%m-%Y') AS bill_date,

        -- 🟦 raw date for logic/sorting
        s.sale_date AS bill_date_raw,

        s.customer_name,
        s.customer_contact,
        s.vehicle_no,
        s.sub_total,
        s.discount_amount,
        s.gst_amount,
        s.final_amount,

        s.payment_type,
        s.remarks,
        s.amount_received,

        -- COMPANY DETAILS
        c.name AS company_name,
        c.address AS company_address,
        c.contact AS company_contact,
        c.gstin AS company_gstin,

        JSON_ARRAYAGG(
          JSON_OBJECT(
            'item_id', si.item_id,
            'item_name', i.itemName,
            'unit', i.unit,
            'quantity', si.quantity,
            'rate', si.sale_price,
            'line_total', si.line_total
          )
        ) AS items

      FROM sales s
      LEFT JOIN sale_items si ON s.id = si.sale_id
      LEFT JOIN items i ON si.item_id = i.id
      LEFT JOIN company c ON s.company_id = c.id
      WHERE s.id = ? AND s.company_id = ?
      GROUP BY s.id
    `;

    const [rows] = await db.query(query, [saleId, companyId]);

    if (!rows.length) return respond(res, null, "Bill not found", 404);

    respond(res, rows[0]);

  } catch (err) {
    console.log(err);
    res.status(500).json({ msg: err.message });
  }
};


// -------------------------------------------------
//  GET ALL SALES AS BILL LIST
// -------------------------------------------------
export const getBills = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const query = `
      SELECT 
        id,
        invoice_number AS bill_number,

        -- 🟩 formatted for UI
        DATE_FORMAT(sale_date, '%d-%m-%Y') AS bill_date,

        -- 🟦 raw date for sorting
        sale_date AS bill_date_raw,

        customer_name,
        customer_contact,
        final_amount,
        payment_type
      FROM sales
      WHERE delete_status = 0 AND company_id = ?
      ORDER BY sale_date DESC, id DESC;
    `;

    const [rows] = await db.query(query, [companyId]);
    respond(res, rows);

  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};
