import { prisma } from "./db.js";
import bcrypt from "bcryptjs";

const FACILITY_NAME = process.env.SEED_FACILITY_NAME || "Mubogi Pharmacy (Demo)";
const OWNER_PIN = process.env.SEED_OWNER_PIN || "1234";
const CASHIER_PIN = process.env.SEED_CASHIER_PIN || "2345";

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const INVENTORY = [
  { drugName: "Paracetamol 500mg", unitType: "Strip of 10", quantity: 120, costPrice: 500, sellingPrice: 1000, expiryDate: new Date("2027-06-30"), reorderLevel: 30 },
  { drugName: "Amoxicillin 250mg", unitType: "Strip of 10", quantity: 80, costPrice: 1500, sellingPrice: 3000, expiryDate: new Date("2026-12-15"), reorderLevel: 20 },
  { drugName: "Metronidazole 400mg", unitType: "Strip of 10", quantity: 60, costPrice: 800, sellingPrice: 1600, expiryDate: new Date("2026-10-01"), reorderLevel: 20 },
  { drugName: "ORS Sachet", unitType: "Bottle", quantity: 40, costPrice: 1200, sellingPrice: 1800, expiryDate: new Date("2028-01-31"), reorderLevel: 10 },
  { drugName: "Ibuprofen 400mg", unitType: "Strip of 10", quantity: 180, costPrice: 800, sellingPrice: 1500, expiryDate: new Date("2027-03-31"), reorderLevel: 30 },
  { drugName: "Cotrimoxazole 480mg", unitType: "Strip of 10", quantity: 60, costPrice: 1000, sellingPrice: 2000, expiryDate: new Date("2027-01-15"), reorderLevel: 15 },
  { drugName: "Cough Syrup (100ml)", unitType: "Bottle", quantity: 25, costPrice: 2000, sellingPrice: 3500, expiryDate: new Date("2026-11-30"), reorderLevel: 10 },
  { drugName: "Artemether/Lumefantrine (Coartem)", unitType: "Strip of 6", quantity: 45, costPrice: 4000, sellingPrice: 6000, expiryDate: new Date("2027-08-31"), reorderLevel: 20 },
];

async function main() {
  const ownerPinHash = await bcrypt.hash(OWNER_PIN, 10);
  const cashierPinHash = await bcrypt.hash(CASHIER_PIN, 10);

  await prisma.facility.upsert({
    where: { id: "demo-facility-01" },
    update: {},
    create: {
      id: "demo-facility-01",
      name: FACILITY_NAME,
      subscriptionTier: "PRO",
      users: {
        create: [
          { id: "demo-user-owner", name: "Mubogi (Owner)", role: "OWNER", pinCode: ownerPinHash },
          { id: "demo-user-cashier", name: "Amina (Cashier)", role: "CASHIER", pinCode: cashierPinHash },
          { id: "demo-user-pharmacist", name: "Dr. Sarah (Pharmacist)", role: "PHARMACIST", pinCode: await bcrypt.hash("3456", 10) },
        ],
      },
    },
  });

  for (const item of INVENTORY) {
    const id = "demo-inv-" + slug(item.drugName);
    await prisma.inventory.upsert({
      where: { id },
      update: {},
      create: {
        id,
        facilityId: "demo-facility-01",
        ...item,
      },
    });
  }

  console.log("Seed complete: %s", FACILITY_NAME);
  console.log("Owner PIN: %s | Cashier PIN: %s | Pharmacist PIN: 3456", OWNER_PIN, CASHIER_PIN);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
