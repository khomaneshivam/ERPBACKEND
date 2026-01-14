import { db } from "../config/db.js";

/* ============================================================================
   1️⃣ MACHINERY MASTER — ADD
============================================================================ */
export const addMachinery = async (req, res) => {
  try {
    const { date, machinery_name, machinery_no, machinery_type, remark } = req.body;

    const company_id = req.user.companyId;
    const created_by = req.user.id;

    await db.query(
      `INSERT INTO machinery_master 
      (date, machinery_name, machinery_no, machinery_type, remark, company_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        date || null,
        machinery_name || null,
        machinery_no || null,
        machinery_type || null,
        remark || null,
        company_id,
        created_by
      ]
    );

    res.json({ success: true, msg: "Machinery saved" });
  } catch (err) {
    console.error("ADD MACHINERY ERR:", err);
    res.status(500).json({ msg: "Server error" });
  }
};

/* ============================================================================
   2️⃣ GET MACHINERY MASTER LIST
============================================================================ */
export const getMachinery = async (req, res) => {
  try {
    const company_id = req.user.companyId;

    const [rows] = await db.query(
      `SELECT 
        machinery_master.*,
         DATE_FORMAT(date, '%Y-%m-%d') AS date,
         users.name as created_by_name
       FROM machinery_master 
       LEFT JOIN users ON machinery_master.created_by = users.id 
       WHERE machinery_master.company_id = ? AND machinery_master.delete_status = 0
       ORDER BY id DESC`,
      [company_id]
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("GET MACHINERY ERR:", err);
    res.status(500).json({ msg: "Server error" });
  }
};

/* ============================================================================
   2.1️⃣ DELETE MACHINERY MASTER (Missing Function)
============================================================================ */
export const deleteMachinery = async (req, res) => {
  try {
    const { id } = req.params;
    const company_id = req.user.companyId;

    // Soft delete
    const [result] = await db.query(
      `UPDATE machinery_master SET delete_status = 1 
       WHERE id = ? AND company_id = ?`,
      [id, company_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ msg: "Machinery not found or already deleted" });
    }

    res.json({ success: true, msg: "Machinery deleted" });
  } catch (err) {
    console.error("DELETE MACHINERY MASTER ERR:", err);
    res.status(500).json({ msg: "Server error" });
  }
};

/* ============================================================================
   3️⃣ ADD MACHINERY RECORD
============================================================================ */
export const addMachineryRecord = async (req, res) => {
  try {
    const {
      date,
      machinery_id,
      start_reading,
      stop_reading,
      fuel_intake,
      remark
    } = req.body;

    const company_id = req.user.companyId;
    const created_by = req.user.id;

    const start = Number(start_reading || 0);
    const stop = Number(stop_reading || 0);
    const total_reading = stop - start;
    const fuel = fuel_intake === "" || fuel_intake === null ? 0 : Number(fuel_intake);

    await db.query(
      `INSERT INTO machinery_records
      (date, machinery_id, start_reading, stop_reading, total_reading,
       fuel_intake, remark, company_id, created_by, delete_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        date || null,
        machinery_id || null,
        start,
        stop,
        total_reading,
        fuel,
        remark || null,
        company_id,
        created_by
      ]
    );

    res.json({ success: true, msg: "Machinery record saved" });
  } catch (err) {
    console.error("ADD MACHINERY RECORD ERR:", err);
    res.status(500).json({ msg: "Server error" });
  }
};

/* ============================================================================
   4️⃣ GET MACHINERY RECORD LIST
============================================================================ */
export const getMachineryRecord = async (req, res) => {
  try {
    const company_id = req.user.companyId;

    const [rows] = await db.query(
      `SELECT 
          mr.id,
          DATE_FORMAT(mr.date, '%Y-%m-%d') AS date,
          mr.start_reading,
          mr.stop_reading,
          mr.total_reading,
          mr.fuel_intake,
          mr.remark,
          mr.machinery_id,
          m.machinery_name,
          m.machinery_no,
          u.name as created_by_name

       FROM machinery_records mr
       LEFT JOIN machinery_master m ON mr.machinery_id = m.id
       LEFT JOIN users u on mr.created_by = u.id
       WHERE mr.company_id = ? AND mr.delete_status = 0
       ORDER BY mr.id DESC`,
      [company_id]
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("GET MACHINERY RECORD ERR:", err);
    res.status(500).json({ msg: "Server error" });
  }
};

/* ============================================================================
   5️⃣ UPDATE MACHINERY RECORD
============================================================================ */
export const updateMachineryRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      date,
      machinery_id,
      start_reading,
      stop_reading,
      fuel_intake,
      remark
    } = req.body;

    const company_id = req.user.companyId;

    const start = Number(start_reading || 0);
    const stop = Number(stop_reading || 0);
    const total_reading = stop - start;
    const fuel = fuel_intake === "" || fuel_intake === null ? 0 : Number(fuel_intake);

    await db.query(
      `UPDATE machinery_records
       SET date = ?, machinery_id = ?, start_reading = ?, stop_reading = ?, 
           total_reading = ?, fuel_intake = ?, remark = ?
       WHERE id = ? AND company_id = ?`,
      [
        date,
        machinery_id,
        start,
        stop,
        total_reading,
        fuel,
        remark,
        id,
        company_id
      ]
    );

    res.json({ success: true, msg: "Record updated" });
  } catch (err) {
    console.error("UPDATE MACHINERY RECORD ERR:", err);
    res.status(500).json({ msg: "Server error" });
  }
};

/* ============================================================================
   6️⃣ DELETE MACHINERY RECORD
============================================================================ */
export const deleteMachineryRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const company_id = req.user.companyId;

    await db.query(
      `UPDATE machinery_records SET delete_status = 1 
       WHERE id = ? AND company_id = ?`,
      [id, company_id]
    );

    res.json({ success: true, msg: "Record deleted" });
  } catch (err) {
    console.error("DELETE MACHINERY RECORD ERR:", err);
    res.status(500).json({ msg: "Server error" });
  }
};