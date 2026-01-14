import mysql from "mysql2/promise";

export const db = mysql.createPool({
  host: "72.61.229.126",
  user: "shivam",
  password: "@Shivam930738",
  database: "erp",
  port: 3306,
  connectionLimit: 10,
});
