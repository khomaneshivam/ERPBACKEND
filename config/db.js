import mysql from "mysql2/promise";

export const db = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "@Shivam930738",
  database: "ERP",
  port: 3306,
  connectionLimit: 10,
});




