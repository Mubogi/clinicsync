import dotenv from "dotenv";
dotenv.config();

export const PORT = process.env.PORT || 5000;
export const JWT_SECRET = process.env.JWT_SECRET || "clinicsync-dev-secret-change-me";
export const CORS_ORIGINS = (process.env.CORS_ORIGINS || "http://localhost:5173").split(",").map(s => s.trim()).filter(Boolean);