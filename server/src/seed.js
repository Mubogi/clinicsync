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

// Products carry multi-unit prices (tablet/strip/box) so small drug shops can
// sell per tablet AND per strip, while big pharmacies sell per strip/box.
const PRODUCTS = [
  {
    name: "Paracetamol 500mg",
    genericName: "Paracetamol",
    tabletPrice: 100,
    stripPrice: 1000,
    boxPrice: 4800,
    costPrice: 500,
  },
  {
    name: "Amoxicillin 250mg",
    genericName: "Amoxicillin",
    tabletPrice: 300,
    stripPrice: 3000,
    boxPrice: 15000,
    costPrice: 1500,
  },
  {
    name: "Metronidazole 400mg",
    genericName: "Metronidazole",
    tabletPrice: 160,
    stripPrice: 1600,
    boxPrice: 7800,
    costPrice: 800,
  },
  {
    name: "ORS Sachet",
    genericName: "ORS",
    tabletPrice: null,
    stripPrice: null,
    boxPrice: null,
    costPrice: 1200,
  },
  {
    name: "Ibuprofen 400mg",
    genericName: "Ibuprofen",
    tabletPrice: 150,
    stripPrice: 1500,
    boxPrice: 7200,
    costPrice: 800,
  },
  {
    name: "Cotrimoxazole 480mg",
    genericName: "Cotrimoxazole",
    tabletPrice: 200,
    stripPrice: 2000,
    boxPrice: 9600,
    costPrice: 1000,
  },
  {
    name: "Cough Syrup (100ml)",
    genericName: "Cough Syrup",
    tabletPrice: null,
    stripPrice: null,
    boxPrice: null,
    costPrice: 2000,
  },
  {
    name: "Artemether/Lumefantrine (Coartem)",
    genericName: "Coartem",
    tabletPrice: null,
    stripPrice: 6000,
    boxPrice: 28000,
    costPrice: 4000,
  },
];

const INVENTORY = [
  { productName: "Paracetamol 500mg", unitType: "Strip of 10", quantity: 120, costPrice: 500, sellingPrice: 1000, expiryDate: new Date("2027-06-30"), reorderLevel: 30 },
  { productName: "Amoxicillin 250mg", unitType: "Strip of 10", quantity: 80, costPrice: 1500, sellingPrice: 3000, expiryDate: new Date("2026-12-15"), reorderLevel: 20 },
  { productName: "Metronidazole 400mg", unitType: "Strip of 10", quantity: 60, costPrice: 800, sellingPrice: 1600, expiryDate: new Date("2026-10-01"), reorderLevel: 20 },
  { productName: "ORS Sachet", unitType: "Bottle", quantity: 40, costPrice: 1200, sellingPrice: 1800, expiryDate: new Date("2028-01-31"), reorderLevel: 10 },
  { productName: "Ibuprofen 400mg", unitType: "Strip of 10", quantity: 180, costPrice: 800, sellingPrice: 1500, expiryDate: new Date("2027-03-31"), reorderLevel: 30 },
  { productName: "Cotrimoxazole 480mg", unitType: "Strip of 10", quantity: 60, costPrice: 1000, sellingPrice: 2000, expiryDate: new Date("2027-01-15"), reorderLevel: 15 },
  { productName: "Cough Syrup (100ml)", unitType: "Bottle", quantity: 25, costPrice: 2000, sellingPrice: 3500, expiryDate: new Date("2026-11-30"), reorderLevel: 10 },
  { productName: "Artemether/Lumefantrine (Coartem)", unitType: "Strip of 6", quantity: 45, costPrice: 4000, sellingPrice: 6000, expiryDate: new Date("2027-08-31"), reorderLevel: 20 },
];

async function main() {
  const ownerPinHash = await bcrypt.hash(OWNER_PIN, 10);
  const cashierPinHash = await bcrypt.hash(CASHIER_PIN, 10);
  const pharmacistPinHash = await bcrypt.hash("3456", 10);

  await prisma.facility.upsert({
    where: { id: "demo-facility-01" },
    update: {
      name: FACILITY_NAME,
      brandName: FACILITY_NAME,
      tagline: "Offline-first clinic & pharmacy management",
      address: "Kampala, Uganda",
      phone: "+256 754 687 597",
      subscriptionTier: "PRO",
    },
    create: {
      id: "demo-facility-01",
      name: FACILITY_NAME,
      slug: "mubogi-pharmacy-demo",
      brandName: FACILITY_NAME,
      tagline: "Offline-first clinic & pharmacy management",
      address: "Kampala, Uganda",
      phone: "+256 754 687 597",
      subscriptionTier: "PRO",
      users: {
        create: [
          { id: "demo-user-owner", name: "Mubogi (Owner)", role: "OWNER", pinCode: ownerPinHash },
          { id: "demo-user-cashier", name: "Amina (Cashier)", role: "CASHIER", pinCode: cashierPinHash },
          { id: "demo-user-pharmacist", name: "Dr. Sarah (Pharmacist)", role: "PHARMACIST", pinCode: pharmacistPinHash },
        ],
      },
    },
  });

  // Create products (multi-unit pricing) and link inventory batches to them
  for (const product of PRODUCTS) {
    const pid = "demo-prod-" + slug(product.name);
    await prisma.product.upsert({
      where: { id: pid },
      update: {},
      create: {
        id: pid,
        facilityId: "demo-facility-01",
        name: product.name,
        genericName: product.genericName,
        tabletPrice: product.tabletPrice,
        stripPrice: product.stripPrice,
        boxPrice: product.boxPrice,
        costPrice: product.costPrice,
      },
    });
  }

  for (const item of INVENTORY) {
    const id = "demo-inv-" + slug(item.productName);
    const product = await prisma.product.findUnique({
      where: { id: "demo-prod-" + slug(item.productName) },
    });
    await prisma.inventory.upsert({
      where: { id },
      update: {
        productId: product?.id ?? undefined,
        drugName: item.productName,
        unitType: item.unitType,
        costPrice: item.costPrice,
        sellingPrice: item.sellingPrice,
        expiryDate: item.expiryDate,
        reorderLevel: item.reorderLevel,
      },
      create: {
        id,
        facilityId: "demo-facility-01",
        productId: product?.id || null,
        drugName: item.productName,
        unitType: item.unitType,
        quantity: item.quantity,
        costPrice: item.costPrice,
        sellingPrice: item.sellingPrice,
        expiryDate: item.expiryDate,
        reorderLevel: item.reorderLevel,
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
