import { db } from "../config/db.js";

// ---------------- UTILITY ----------------
const respond = (res, data = null, msg = "Success", statusCode = 200) => {
  const status = statusCode === "Created" ? 201 : statusCode;
  return res.status(status).json({ msg, data });
};

// --------------------- ITEM MASTER ---------------------

export const addItem = async (req, res) => {
  try {
    console.log("🟩 REQ.USER =", req.user);
    console.log("🟩 REQ.BODY =", req.body);

    const userId = req.user?.id;
    const companyId = req.user?.companyId;

    const { itemCode, itemName, category, unit } = req.body;

    const [result] = await db.query(
      `INSERT INTO items 
        (itemCode, itemName, category, unit, company_id, created_by) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [itemCode, itemName, category, unit, companyId, userId]
    );

    res.status(201).json({ msg: "Item Added", data: { id: result.insertId } });

  } catch (err) {
    console.log("❌ BACKEND ERROR =", err);
    res.status(500).json({ msg: err.message });
  }
};
export const getItems = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const [items] = await db.query(
      `SELECT items.*, users.name as created_by_name 
      FROM items 
      LEFT JOIN users ON items.created_by = users.id 
      WHERE items.company_id = ? AND items.delete_status = 0 
      ORDER BY items.id DESC`,
      [companyId]
    );

    return res.status(200).json({
      msg: "Success",
      data: items,   // Always send array inside "data"
    });

  } catch (err) {
    console.log("❌ GET ITEMS ERROR =", err);
    res.status(500).json({ msg: err.message });
  }
};

export const updateItem = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const {
      itemCode, itemName, category, unit
    } = req.body;

    await db.query(
      `UPDATE items SET 
        itemCode=?, itemName=?, category=?, unit=?, 
        modified_by=? 
       WHERE id=? AND company_id = ?`, // Security check
      [
        itemCode, itemName, category, unit,
        userId, id, req.user.companyId
      ]
    );
    respond(res, null, "Item Updated");
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};
export const deleteItem = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;

    const [result] = await db.query(
      `
      UPDATE items
      SET delete_status = 1
      WHERE id = ? AND company_id = ?
      `,
      [id, companyId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ msg: "Item not found" });
    }

    respond(res, null, "Item deleted");
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};
// --------------------- PARTY MASTER ---------------------

export const addParty = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const {
      name, address, zipcode, contact, contact_person, party_type, email, gstin,
    } = req.body;

    const [result] = await db.query(
      `INSERT INTO parties 
        (name, address, zipcode, contact, contact_person, party_type, email, gstin, 
         company_id, created_by) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name, address, zipcode, contact, contact_person, party_type, email, gstin,
        companyId, userId,
      ]
    );
    respond(res, { id: result.insertId }, "Party Added", "Created");
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getParties = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const [data] = await db.query(
      `SELECT parties.*, users.name as created_by_name 
      FROM parties 
      LEFT JOIN users ON parties.created_by = users.id 
      WHERE parties.company_id = ? AND parties.delete_status = 0 
      ORDER BY parties.id DESC`,
      [companyId]
    );
    respond(res, data);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const updateParty = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const {
      name, address, zipcode, contact, contact_person, party_type, email, gstin,
    } = req.body;

    await db.query(
      `UPDATE parties SET 
        name=?, address=?, zipcode=?, contact=?, contact_person=?, party_type=?, email=?, gstin=?, 
        modified_by=? 
       WHERE id=? AND company_id = ?`,
      [
        name, address, zipcode, contact, contact_person, party_type, email, gstin,
        userId, id, req.user.companyId
      ]
    );
    respond(res, null, "Party Updated");
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const deleteParty = async (req, res) => {
  try {
    const userId = req.user.id;
    await db.query(
      "UPDATE parties SET delete_status = 1, modified_by = ? WHERE id = ? AND company_id = ?",
      [userId, req.params.id, req.user.companyId]
    );
    respond(res, null, "Party Deleted");
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// --------------------- EXPENSE MASTER ---------------------

export const addExpense = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { expense_date, expense_head_id, title, amount, payment_type, remarks } = req.body;

    const [result] = await db.query(
      `INSERT INTO expenses 
        (expense_date, expense_head_id, title, amount, payment_type, remarks, 
         company_id, created_by) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [expense_date, expense_head_id, title, amount, payment_type, remarks, companyId, userId]
    );
    respond(res, { id: result.insertId }, "Expense Added", "Created");
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getExpenses = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    // pagination
    const page = Number(req.query.page) || 0;
    const limit = Number(req.query.limit) || 10;
    const offset = page * limit;

    // fetch paginated records
    const [records] = await db.query(
      `
        SELECT e.*, eh.category_name
        FROM expenses e
        LEFT JOIN expense_heads eh ON e.expense_head_id = eh.id
        WHERE e.company_id = ? AND e.delete_status = 0
        ORDER BY e.expense_date DESC
        LIMIT ? OFFSET ?
      `,
      [companyId, limit, offset]
    );

    // total count
    const [count] = await db.query(
      `SELECT COUNT(*) AS total 
       FROM expenses 
       WHERE company_id = ? AND delete_status = 0`,
      [companyId]
    );

    return res.status(200).json({
      msg: "Success",
      data: {
        records,
        total: count[0].total,
        page,
        limit
      }
    });

  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const deleteExpense = async (req, res) => {
  try {
    const userId = req.user.id;
    await db.query(
      "UPDATE expenses SET delete_status = 1, modified_by = ? WHERE id = ? AND company_id = ?",
      [userId, req.params.id, req.user.companyId]
    );
    respond(res, null, "Expense Deleted");
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// --------------------- BANK MASTER ---------------------

export const addBank = async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.companyId;
    const { bank_name, account_no, ifsc, branch } = req.body;

    const [result] = await db.query(
      `INSERT INTO banks 
        (bank_name, account_no, ifsc, branch, 
         company_id, created_by) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [bank_name, account_no, ifsc, branch, companyId, userId]
    );
    respond(res, { id: result.insertId }, "Bank Added", "Created");
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getBanks = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const [data] = await db.query(
       `SELECT banks.*, users.name as created_by_name 
      FROM banks 
      LEFT JOIN users ON banks.created_by = users.id 
      WHERE banks.company_id = ? AND banks.delete_status = 0 
      ORDER BY banks.id DESC`,
      [companyId]
    );
    respond(res, data);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const deleteBank = async (req, res) => {
  try {
    const userId = req.user.id;
    await db.query(
      "UPDATE banks SET delete_status = 1, modified_by = ? WHERE id = ? AND company_id = ?",
      [userId, req.params.id, req.user.companyId]
    );
    respond(res, null, "Bank Deleted");
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

// --------------------- COMPANY MASTER ---------------------
// This is for the user's OWN company profile

export const addCompany = async (req, res) => {
  try {
    // This function is generally not used after registration
    // But if it is, it should be highly restricted
    const userId = req.user.id;
    const { name, address, zipcode, contact, contact_person, gstin } = req.body;

    const [result] = await db.query(
      `INSERT INTO company 
        (name, address, zipcode, contact, contact_person, gstin, 
         created_by, modified_by) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, address, zipcode, contact, contact_person, gstin, userId, userId]
    );
    respond(res, { id: result.insertId }, "Company Added", "Created");
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const getCompanies = async (req, res) => {
  try {
    // A user should only see their own company
    const companyId = req.user.companyId;
    const [data] = await db.query(
      "SELECT * FROM company WHERE id = ? AND delete_status = 0",
      [companyId]
    );
    respond(res, data);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const updateCompany = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params; // The company ID to update
    const { name, address, zipcode, contact, contact_person, gstin } = req.body;

    // Security check: Make sure the user is updating their OWN company
    if (parseInt(id, 10) !== req.user.companyId) {
      return res.status(403).json({ msg: "Forbidden: You can only update your own company." });
    }

    await db.query(
      `UPDATE company SET 
        name=?, address=?, zipcode=?, contact=?, contact_person=?, gstin=?, 
        modified_by=? 
       WHERE id=?`,
      [name, address, zipcode, contact, contact_person, gstin, userId, id]
    );
    respond(res, null, "Company Updated");
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};

export const deleteCompany = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // Security check
    if (parseInt(id, 10) !== req.user.companyId) {
      return res.status(403).json({ msg: "Forbidden: You can only delete your own company." });
    }
    
    // This will "soft delete" the company profile
    await db.query(
      "UPDATE company SET delete_status = 1, modified_by = ? WHERE id = ?",
      [userId, id]
    );
    respond(res, null, "Company Deleted");
  } catch (err)
 {
    res.status(500).json({ msg: err.message });
  }
};


export const getCompanyDetails = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const [rows] = await db.query(
      "SELECT * FROM company WHERE id = ? AND delete_status = 0",
      [companyId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ msg: "Company not found" });
    }

    res.json({ msg: "Success", data: rows[0] });

  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
};