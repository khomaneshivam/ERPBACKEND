import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "../config/db.js";
import dotenv from "dotenv";

dotenv.config();

// Utility function
const respond = (res, data = null, msg = "Success", statusCode = 200) => {
  const status = statusCode === "Created" ? 201 : statusCode;
  return res.status(status).json({ msg, data });
};


export const registerUser = async (req, res) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    const { name, email, password, companyName, companyId, role } = req.body;

    // 1. Basic Validation
    if (!name || !email || !password) {
      return res.status(400).json({ msg: "Name, Email, and Password are required" });
    }

    // 2. Check if email exists
    const [existingUser] = await connection.query("SELECT * FROM users WHERE email = ?", [email]);
    if (existingUser.length > 0) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ msg: "Email already registered" });
    }

    let finalCompanyId = null;
    let finalRole = role || 'employee'; // Default to employee if not specified

    // ---------------------------------------------------------
    // SCENARIO A: JOINING EXISTING COMPANY (User provided companyId)
    // ---------------------------------------------------------
    if (companyId) {
      const [companyCheck] = await connection.query("SELECT id FROM company WHERE id = ?", [companyId]);
      
      if (companyCheck.length === 0) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({ msg: "Invalid Company ID. Company not found." });
      }
      
      finalCompanyId = companyId;
    } 
    // ---------------------------------------------------------
    // SCENARIO B: CREATING NEW COMPANY (User provided companyName)
    // ---------------------------------------------------------
    else if (companyName) {
      const [companyResult] = await connection.query("INSERT INTO company (name) VALUES (?)", [companyName]);
      finalCompanyId = companyResult.insertId;
      finalRole = 'admin'; // Creator of a company is ALWAYS admin
    } 
    else {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ msg: "Please provide either a Company Name (to create) or Company ID (to join)." });
    }

    // 3. Create the User
    const hashedPassword = await bcrypt.hash(password, 10);
    const [userResult] = await connection.query(
      "INSERT INTO users (name, email, password, role, company_id) VALUES (?, ?, ?, ?, ?)",
      [name, email, hashedPassword, finalRole, finalCompanyId]
    );

    // 4. If New Company, set created_by
    if (companyName) {
      await connection.query(
        "UPDATE company SET created_by = ? WHERE id = ?",
        [userResult.insertId, finalCompanyId]
      );
    }

    await connection.commit();
    res.status(201).json({ msg: "Registration successful", companyId: finalCompanyId });

  } catch (err) {
    await connection.rollback();
    console.error("Register Error:", err);
    res.status(500).json({ msg: "Server error" });
  } finally {
    if (connection) connection.release();
  }
};
// ✅ Login User
// ✅ Login User (FIXED)
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ msg: "All fields are required" });

    // ✅ JOIN company to get company_name
    const [rows] = await db.query(
      `
      SELECT 
        u.id,
        u.name,
        u.email,
        u.password,
        u.role,
        u.company_id,
        c.name AS company_name
      FROM users u
      JOIN company c ON c.id = u.company_id
      WHERE u.email = ?
        AND u.delete_status = 0
      `,
      [email]
    );

    if (rows.length === 0)
      return res.status(400).json({ msg: "Invalid email or password" });

    const user = rows[0];

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(400).json({ msg: "Invalid email or password" });

    // ✅ JWT NOW HAS REAL DATA
    const token = jwt.sign(
      {
        id: user.id,
        name: user.name,
        role: user.role,
        companyId: user.company_id,
        company_name: user.company_name, // ✅ REAL VALUE
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({
      msg: "✅ Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        companyId: user.company_id,
        company_name: user.company_name, // ✅ REAL VALUE
      },
    });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ msg: "Server error" });
  }
};
