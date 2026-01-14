import jwt from "jsonwebtoken";

export const auth = async (req, res, next) => {
  try {
    const authHeader = req.header("Authorization");

    if (!authHeader) {
      return res.status(401).json({ msg: "No token, authorization denied" });
    }

    const token = authHeader.replace("Bearer ", "");

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // ✅ PASS EVERYTHING YOU NEED DOWNSTREAM
      req.user = {
        id: decoded.id,
        name: decoded.name,
        role: decoded.role,
        companyId: decoded.companyId,
        company_name: decoded.company_name, // 🔥 THIS WAS MISSING
      };

      next();
    } catch (verifyErr) {
      return res.status(401).json({ msg: "Token invalid or expired" });
    }
  } catch (err) {
    return res.status(500).json({ msg: "Auth system error" });
  }
};
