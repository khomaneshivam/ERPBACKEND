// controllers/balanceController.js
import { db } from "../config/db.js";

// ---------------------------------------------
// GET TOTAL CASH BALANCE & TOTAL ONLINE BALANCE
// ---------------------------------------------
export const getTotalBalances = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const query = `
      SELECT 
        -- SUM OF CASH RECEIVED IN SALES
        (
          SELECT IFNULL(SUM(amount_received), 0)
          FROM sales
          WHERE company_id = ? 
            AND delete_status = 0
            AND payment_type = 'Cash'
        ) AS total_cash,

        -- SUM OF ALL BANK ACCOUNT BALANCES
        (
          SELECT IFNULL(SUM(account_balance), 0)
          FROM banks
          WHERE company_id = ? AND delete_status = 0
        ) AS total_online
      ;
    `;

    const [rows] = await db.query(query, [companyId, companyId]);
    const result = rows[0];

    return res.json({
      success: true,
      data: {
        cash_balance: Number(result.total_cash),
        online_balance: Number(result.total_online),
        liquidity: Number(result.total_cash) + Number(result.total_online),
      },
    });
  } catch (err) {
    console.error("Balance Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};
