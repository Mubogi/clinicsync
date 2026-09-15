import { Router } from "express";

import { searchMedicines, MEDICINE_CATEGORIES } from "../ugMedicines.js";

const router = Router();

// Public search over the Uganda drug library (used in inventory + onboarding)
router.get("/medicines", (req, res) => {
  const q = (req.query.q || "").toString();
  const category = (req.query.category || "").toString();
  const limit = Math.min(Number(req.query.limit) || 40, 200);
  const results = searchMedicines(q).filter(
    (m) => !category || m.category === category
  );
  res.json({
    count: results.length,
    total: searchMedicines("").length,
    categories: MEDICINE_CATEGORIES,
    medicines: results.slice(0, limit),
  });
});

export default router;