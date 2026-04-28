#!/usr/bin/env node
/**
 * Seed the database with realistic procurement data.
 * Idempotent — skips if vendors already exist.
 *
 * Usage: node bin/seed.js
 *        TASKBRIDGE_DB_PATH=data/tasks.db node bin/seed.js
 */
import { randomUUID } from "node:crypto";
import { config } from "../src/config.js";
import { createDatabase } from "../src/db/adapter.js";
import { SQLITE_SCHEMA, migrateSqlite } from "../src/db/sqlite-schema.js";

const uuid = () => randomUUID();

const main = async () => {
  const dbDriver = process.env.DB_DRIVER || "sqlite";
  const db = await createDatabase(dbDriver, {
    path: config.dbPath,
    url: process.env.DATABASE_URL,
  });

  // Run schema
  if (dbDriver === "postgres") {
    const { readFile } = await import("node:fs/promises");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "../src/db/schema.sql");
    await db.exec(await readFile(schemaPath, "utf8"));
  } else {
    await db.exec(SQLITE_SCHEMA);
    await migrateSqlite(db);
  }

  const vendorCountRow = await db.queryOne("SELECT COUNT(*) as n FROM vendors", {});
  if (vendorCountRow.n > 0) {
    console.log(`⏭  Database already has ${vendorCountRow.n} vendor(s) — skipping seed.`);
    await db.close();
    process.exit(0);
  }

  console.log(`🌱 Seeding ${config.dbPath} …`);

  const now = Date.now();
  const days = (d) => d * 86_400_000;

  // ─── Vendor IDs (generated once, referenced throughout) ───

  const VID = {
    acme:      uuid(),
    metalco:   uuid(),
    wirepro:   uuid(),
    buildmax:  uuid(),
    plumbworks: uuid(),
    safetyplus: uuid(),
  };

  const VENDORS = [
    {
      id: VID.acme,
      name: "Acme Steel Corporation",
      email: "sales@acmesteel.com",
      phone: "+1-555-100-2001",
      address: "1200 Industrial Blvd, Houston TX 77001",
      categories: ["steel", "structural", "rebar"],
      leadTimeDays: 14,
      currency: "USD",
      notes: "ISO 9001 certified. Preferred supplier for structural steel since 2019.",
      materials: [
        { materialName: "Steel rebar", category: "steel", unit: "kg", referencePrice: 12.50, minOrderQty: 100, notes: "Grade 60, available in 10mm–32mm" },
        { materialName: "Steel I-beam", category: "structural", unit: "meter", referencePrice: 85.00, minOrderQty: 10, notes: "W-shape, ASTM A992" },
        { materialName: "Steel plate", category: "steel", unit: "kg", referencePrice: 15.00, minOrderQty: 50, notes: "Hot-rolled, 6mm–50mm thickness" },
        { materialName: "Steel angle", category: "structural", unit: "meter", referencePrice: 18.50, minOrderQty: 20, notes: "Equal and unequal leg available" },
        { materialName: "Steel pipe", category: "steel", unit: "meter", referencePrice: 32.00, minOrderQty: 10, notes: "Schedule 40/80, 1\"–12\" diameter" },
      ],
    },
    {
      id: VID.metalco,
      name: "MetalCo Industries",
      email: "rfq@metalco.com",
      phone: "+1-555-200-3002",
      address: "890 Foundry Way, Pittsburgh PA 15201",
      categories: ["steel", "aluminum", "stainless"],
      leadTimeDays: 7,
      currency: "USD",
      notes: "Fast turnaround. Competitive on small orders. Family-owned since 1985.",
      materials: [
        { materialName: "Steel rebar", category: "steel", unit: "kg", referencePrice: 11.80, minOrderQty: 50, notes: "Grade 40/60" },
        { materialName: "Aluminum sheet", category: "aluminum", unit: "sq_meter", referencePrice: 45.00, minOrderQty: 5, notes: "6061-T6, 1mm–10mm" },
        { materialName: "Stainless steel sheet", category: "stainless", unit: "kg", referencePrice: 28.00, minOrderQty: 25, notes: "304 and 316 grades" },
        { materialName: "Aluminum extrusion", category: "aluminum", unit: "meter", referencePrice: 22.00, minOrderQty: 10, notes: "Custom profiles available" },
      ],
    },
    {
      id: VID.wirepro,
      name: "WirePro Electrical Ltd",
      email: "info@wirepro.com",
      phone: "+66-2-555-4003",
      address: "42/1 Sukhumvit Soi 71, Bangkok 10110",
      categories: ["electrical", "cable", "wiring"],
      leadTimeDays: 21,
      currency: "USD",
      notes: "Thailand-based. Best prices on bulk cable orders. IEC certified.",
      materials: [
        { materialName: "Copper wire", category: "electrical", unit: "meter", referencePrice: 3.20, minOrderQty: 100, notes: "2.5mm² and 4mm², PVC insulated" },
        { materialName: "Electrical cable", category: "cable", unit: "meter", referencePrice: 8.50, minOrderQty: 50, notes: "3-core, 2.5mm², NYY type" },
        { materialName: "PVC conduit", category: "electrical", unit: "piece", referencePrice: 4.80, minOrderQty: 50, notes: "25mm diameter, 3m length" },
        { materialName: "Cable tray", category: "cable", unit: "meter", referencePrice: 35.00, minOrderQty: 10, notes: "Galvanized, 300mm wide" },
        { materialName: "Junction box", category: "electrical", unit: "piece", referencePrice: 12.00, minOrderQty: 20, notes: "IP65, surface mount" },
        { materialName: "LED panel light", category: "electrical", unit: "piece", referencePrice: 28.00, minOrderQty: 10, notes: "600x600mm, 40W, 4000K" },
      ],
    },
    {
      id: VID.buildmax,
      name: "BuildMax Supply Co",
      email: "orders@buildmax.com",
      phone: "+1-555-300-5004",
      address: "500 Commerce Dr, Dallas TX 75201",
      categories: ["concrete", "masonry", "general"],
      leadTimeDays: 5,
      currency: "USD",
      notes: "Local distributor. Same-day delivery available in DFW metro. Net-30 terms.",
      materials: [
        { materialName: "Portland cement", category: "concrete", unit: "bag", referencePrice: 14.50, minOrderQty: 10, notes: "50kg bags, Type I/II" },
        { materialName: "Ready-mix concrete", category: "concrete", unit: "cubic_meter", referencePrice: 120.00, minOrderQty: 1, notes: "C25/30 standard mix" },
        { materialName: "Concrete block", category: "masonry", unit: "piece", referencePrice: 2.80, minOrderQty: 100, notes: "200x200x400mm, hollow" },
        { materialName: "Sand (construction)", category: "general", unit: "ton", referencePrice: 35.00, minOrderQty: 1, notes: "Washed, medium grain" },
        { materialName: "Gravel (aggregate)", category: "general", unit: "ton", referencePrice: 42.00, minOrderQty: 1, notes: "20mm crushed stone" },
        { materialName: "Rebar tie wire", category: "general", unit: "kg", referencePrice: 3.50, minOrderQty: 5, notes: "1.2mm galvanized" },
      ],
    },
    {
      id: VID.plumbworks,
      name: "PlumbWorks International",
      email: "sales@plumbworks.com",
      phone: "+44-20-7946-0958",
      address: "14 Canal Wharf, London E14 8RS",
      categories: ["plumbing", "HVAC", "pipes"],
      leadTimeDays: 10,
      currency: "USD",
      notes: "UK-based, ships worldwide. Strong on HVAC and plumbing bundles.",
      materials: [
        { materialName: "PVC pipe", category: "plumbing", unit: "meter", referencePrice: 6.00, minOrderQty: 20, notes: "110mm diameter, pressure-rated" },
        { materialName: "Copper pipe", category: "plumbing", unit: "meter", referencePrice: 18.50, minOrderQty: 10, notes: "15mm and 22mm, Type L" },
        { materialName: "Ball valve", category: "plumbing", unit: "piece", referencePrice: 15.00, minOrderQty: 5, notes: "Brass, 1/2\"–2\"" },
        { materialName: "HVAC duct", category: "HVAC", unit: "meter", referencePrice: 42.00, minOrderQty: 5, notes: "Galvanized, rectangular, 300x200mm" },
        { materialName: "Insulation foam", category: "HVAC", unit: "sq_meter", referencePrice: 8.00, minOrderQty: 10, notes: "25mm thickness, closed-cell" },
      ],
    },
    {
      id: VID.safetyplus,
      name: "SafetyPlus Equipment",
      email: "procurement@safetyplus.co",
      phone: "+1-555-400-6005",
      address: "780 Safety Lane, Atlanta GA 30301",
      categories: ["safety", "PPE", "signage"],
      leadTimeDays: 3,
      currency: "USD",
      notes: "Fast delivery on safety equipment. OSHA-compliant inventory. Bulk discounts over $5K.",
      materials: [
        { materialName: "Hard hat", category: "PPE", unit: "piece", referencePrice: 22.00, minOrderQty: 10, notes: "ANSI Type I, Class E, vented" },
        { materialName: "Safety vest", category: "PPE", unit: "piece", referencePrice: 12.00, minOrderQty: 20, notes: "Hi-vis, Class 2, mesh" },
        { materialName: "Safety goggles", category: "PPE", unit: "piece", referencePrice: 8.50, minOrderQty: 20, notes: "Anti-fog, ANSI Z87.1" },
        { materialName: "Safety boots", category: "PPE", unit: "pair", referencePrice: 85.00, minOrderQty: 5, notes: "Steel toe, waterproof" },
        { materialName: "Safety signage set", category: "signage", unit: "set", referencePrice: 120.00, minOrderQty: 1, notes: "Construction site pack, 20 signs" },
        { materialName: "Fire extinguisher", category: "safety", unit: "piece", referencePrice: 45.00, minOrderQty: 2, notes: "ABC dry chemical, 5kg" },
        { materialName: "First aid kit", category: "safety", unit: "piece", referencePrice: 65.00, minOrderQty: 1, notes: "50-person, wall-mount" },
      ],
    },
  ];

  // ─── Seed transaction ───

  await db.transaction(async (tx) => {
    let vendorCount = 0;
    let materialCount = 0;

    for (const v of VENDORS) {
      await tx.execute(
        `INSERT INTO vendors (id, name, email, phone, address, categories, lead_time_days, currency, notes, active, created_at, updated_at)
        VALUES (@id, @name, @email, @phone, @address, @categories, @leadTimeDays, @currency, @notes, 1, @now, @now)`,
        {
          id: v.id,
          name: v.name,
          email: v.email,
          phone: v.phone,
          address: v.address,
          categories: JSON.stringify(v.categories),
          leadTimeDays: v.leadTimeDays,
          currency: v.currency,
          notes: v.notes,
          now,
        }
      );
      vendorCount++;

      for (const m of v.materials) {
        await tx.execute(
          `INSERT INTO vendor_materials (vendor_id, material_name, category, unit, reference_price, price_updated_at, min_order_qty, notes, created_at)
          VALUES (@vendorId, @materialName, @category, @unit, @referencePrice, @priceUpdatedAt, @minOrderQty, @notes, @now)`,
          {
            vendorId: v.id,
            materialName: m.materialName,
            category: m.category,
            unit: m.unit,
            referencePrice: m.referencePrice,
            priceUpdatedAt: now - days(Math.floor(Math.random() * 30)),
            minOrderQty: m.minOrderQty,
            notes: m.notes,
            now,
          }
        );
        materialCount++;
      }
    }

    console.log(`✅ Seeded ${vendorCount} vendors with ${materialCount} materials.`);
  });

  // ─── Purchase history (completed PRs) ───

  const HISTORY = [
    {
      id: uuid(),
      title: "Warehouse expansion — structural steel",
      requestedBy: "James",
      approvedBy: "James",
      notes: "Phase 1 structural materials for new 2000sqm warehouse.",
      daysAgo: 45,
      items: [
        { materialName: "Steel rebar", specification: "12mm Grade 60", quantity: 2000, unit: "kg" },
        { materialName: "Steel I-beam", specification: "W200x46", quantity: 40, unit: "meter" },
        { materialName: "Steel plate", specification: "10mm hot-rolled", quantity: 500, unit: "kg" },
      ],
      vendorQuotes: [
        { vendorId: VID.acme, items: [0, 1, 2], prices: [11.80, 82.00, 14.20], leadTimes: [12, 14, 12] },
        { vendorId: VID.metalco, items: [0, 2], prices: [11.50, 15.00], leadTimes: [7, 7] },
      ],
    },
    {
      id: uuid(),
      title: "Office renovation — electrical & lighting",
      requestedBy: "James",
      approvedBy: "James",
      notes: "Complete rewire of 3rd floor office space.",
      daysAgo: 30,
      items: [
        { materialName: "Copper wire", specification: "2.5mm² PVC", quantity: 500, unit: "meter" },
        { materialName: "Electrical cable", specification: "3-core NYY", quantity: 200, unit: "meter" },
        { materialName: "LED panel light", specification: "40W 4000K", quantity: 24, unit: "piece" },
        { materialName: "Junction box", specification: "IP65", quantity: 30, unit: "piece" },
        { materialName: "PVC conduit", specification: "25mm", quantity: 100, unit: "piece" },
      ],
      vendorQuotes: [
        { vendorId: VID.wirepro, items: [0, 1, 2, 3, 4], prices: [2.90, 7.80, 26.00, 11.00, 4.50], leadTimes: [18, 18, 21, 18, 18] },
      ],
    },
    {
      id: uuid(),
      title: "Foundation pour — concrete & aggregate",
      requestedBy: "admin",
      approvedBy: "James",
      notes: "Materials for 400sqm foundation slab.",
      daysAgo: 60,
      items: [
        { materialName: "Ready-mix concrete", specification: "C30", quantity: 120, unit: "cubic_meter" },
        { materialName: "Steel rebar", specification: "16mm Grade 60", quantity: 3000, unit: "kg" },
        { materialName: "Sand (construction)", specification: "washed medium", quantity: 50, unit: "ton" },
        { materialName: "Gravel (aggregate)", specification: "20mm crushed", quantity: 80, unit: "ton" },
      ],
      vendorQuotes: [
        { vendorId: VID.buildmax, items: [0, 2, 3], prices: [115.00, 32.00, 40.00], leadTimes: [3, 2, 2] },
        { vendorId: VID.acme, items: [1], prices: [12.00], leadTimes: [10] },
        { vendorId: VID.metalco, items: [1], prices: [11.20], leadTimes: [6] },
      ],
    },
    {
      id: uuid(),
      title: "Site safety equipment — PPE restock",
      requestedBy: "admin",
      approvedBy: "admin",
      notes: "Quarterly PPE restock for 50-person construction site.",
      daysAgo: 15,
      items: [
        { materialName: "Hard hat", specification: "ANSI Type I", quantity: 50, unit: "piece" },
        { materialName: "Safety vest", specification: "Class 2 mesh", quantity: 50, unit: "piece" },
        { materialName: "Safety goggles", specification: "anti-fog", quantity: 50, unit: "piece" },
        { materialName: "Safety boots", specification: "steel toe", quantity: 20, unit: "pair" },
        { materialName: "First aid kit", specification: "50-person", quantity: 3, unit: "piece" },
      ],
      vendorQuotes: [
        { vendorId: VID.safetyplus, items: [0, 1, 2, 3, 4], prices: [20.00, 11.00, 7.50, 80.00, 60.00], leadTimes: [2, 2, 2, 3, 2] },
      ],
    },
    {
      id: uuid(),
      title: "Plumbing rough-in — new washrooms",
      requestedBy: "James",
      approvedBy: "James",
      notes: "Plumbing materials for 4 new washroom blocks.",
      daysAgo: 25,
      items: [
        { materialName: "PVC pipe", specification: "110mm pressure", quantity: 200, unit: "meter" },
        { materialName: "Copper pipe", specification: "22mm Type L", quantity: 100, unit: "meter" },
        { materialName: "Ball valve", specification: "brass 1\"", quantity: 40, unit: "piece" },
      ],
      vendorQuotes: [
        { vendorId: VID.plumbworks, items: [0, 1, 2], prices: [5.50, 17.00, 13.50], leadTimes: [8, 10, 8] },
      ],
    },
  ];

  await db.transaction(async (tx) => {
    let prCount = 0;
    let responseCount = 0;

    for (const pr of HISTORY) {
      const createdAt = now - days(pr.daysAgo);
      const completedAt = createdAt + days(Math.floor(pr.daysAgo * 0.3));

      await tx.execute(
        `INSERT INTO purchase_requests (id, title, status, requested_by, approved_by, deadline, notes, created_at, updated_at)
        VALUES (@id, @title, @status, @requestedBy, @approvedBy, @deadline, @notes, @createdAt, @updatedAt)`,
        {
          id: pr.id, title: pr.title, status: "completed",
          requestedBy: pr.requestedBy, approvedBy: pr.approvedBy,
          deadline: createdAt + days(30), notes: pr.notes,
          createdAt, updatedAt: completedAt,
        }
      );

      // Status log
      const transitions = ["draft", "pending_approval", "pending", "processing", "completed"];
      let prevStatus = null;
      for (let i = 0; i < transitions.length; i++) {
        await tx.execute(
          `INSERT INTO pr_status_log (pr_id, from_status, to_status, changed_by, reason, created_at)
          VALUES (@prId, @fromStatus, @toStatus, @changedBy, @reason, @createdAt)`,
          {
            prId: pr.id, fromStatus: prevStatus, toStatus: transitions[i],
            changedBy: pr.requestedBy, reason: null,
            createdAt: createdAt + Math.floor((completedAt - createdAt) * i / transitions.length),
          }
        );
        prevStatus = transitions[i];
      }

      // Line items — completed PRs have all items "received"
      const lineItemIds = [];
      for (const item of pr.items) {
        const info = await tx.execute(
          `INSERT INTO pr_line_items (pr_id, material_name, specification, quantity, unit, status, selected_vendor_id, selected_price, po_number, note, created_at)
          VALUES (@prId, @materialName, @specification, @quantity, @unit, @status, @selectedVendorId, @selectedPrice, @poNumber, @note, @createdAt)`,
          {
            prId: pr.id, materialName: item.materialName,
            specification: item.specification, quantity: item.quantity,
            unit: item.unit, status: "received",
            selectedVendorId: null, selectedPrice: null, poNumber: null, note: null,
            createdAt,
          }
        );
        lineItemIds.push(Number(info.lastId));
      }

      // Vendor quotes + shortlist + RFQs + responses
      for (const vq of pr.vendorQuotes) {
        const rfqId = uuid();
        const sentAt = createdAt + days(2);
        const repliedAt = sentAt + days(vq.leadTimes[0] > 10 ? 3 : 1);

        // Shortlist entries
        for (const itemIdx of vq.items) {
          await tx.execute(
            `INSERT INTO pr_vendor_shortlist (pr_id, vendor_id, line_item_id, reference_price, notes, created_at)
            VALUES (@prId, @vendorId, @lineItemId, @referencePrice, @notes, @createdAt)`,
            {
              prId: pr.id, vendorId: vq.vendorId,
              lineItemId: lineItemIds[itemIdx],
              referencePrice: vq.prices[vq.items.indexOf(itemIdx)],
              notes: null, createdAt,
            }
          );
        }

        // RFQ email
        await tx.execute(
          `INSERT INTO rfq_emails (id, pr_id, vendor_id, to_email, status, gmail_thread_id, line_item_ids, sent_at, replied_at, created_at, updated_at)
          VALUES (@id, @prId, @vendorId, @toEmail, @status, @threadId, @lineItemIds, @sentAt, @repliedAt, @createdAt, @updatedAt)`,
          {
            id: rfqId, prId: pr.id, vendorId: vq.vendorId,
            toEmail: VENDORS.find(v => v.id === vq.vendorId)?.email || "unknown@example.com",
            status: "replied", threadId: uuid(),
            lineItemIds: JSON.stringify(vq.items.map(i => lineItemIds[i])),
            sentAt, repliedAt, createdAt, updatedAt: repliedAt,
          }
        );

        // Vendor responses (one per item)
        for (let qi = 0; qi < vq.items.length; qi++) {
          const itemIdx = vq.items[qi];
          const price = vq.prices[qi];
          const qty = pr.items[itemIdx].quantity;

          await tx.execute(
            `INSERT INTO vendor_responses (rfq_id, pr_id, vendor_id, line_item_id, unit_price, total_price, lead_time_days, min_order_qty, availability, currency, raw_text, parsed_at, created_at)
            VALUES (@rfqId, @prId, @vendorId, @lineItemId, @unitPrice, @totalPrice, @leadTimeDays, @minOrderQty, @availability, @currency, @rawText, @parsedAt, @createdAt)`,
            {
              rfqId, prId: pr.id, vendorId: vq.vendorId,
              lineItemId: lineItemIds[itemIdx],
              unitPrice: price, totalPrice: price * qty,
              leadTimeDays: vq.leadTimes[qi], minOrderQty: null,
              availability: "in_stock", currency: "USD",
              rawText: `We can supply ${pr.items[itemIdx].materialName} at $${price}/${pr.items[itemIdx].unit}, lead time ${vq.leadTimes[qi]} days.`,
              parsedAt: repliedAt, createdAt: repliedAt,
            }
          );
          responseCount++;
        }
      }
      prCount++;
    }

    console.log(`✅ Seeded ${prCount} completed PRs with ${responseCount} vendor responses.`);
  });

  // ─── Active PRs in various statuses ───

  const ACTIVE_PRS = [
    {
      id: uuid(), title: "Server room cooling upgrade — HVAC",
      status: "draft", requestedBy: "admin", daysAgo: 1,
      notes: "Need to replace aging HVAC units in the main server room. Budget pre-approved up to $15K.",
      transitions: ["draft"],
      items: [
        { materialName: "HVAC duct", specification: "300x200mm galvanized", quantity: 30, unit: "meter", status: "draft" },
        { materialName: "Insulation foam", specification: "25mm closed-cell", quantity: 60, unit: "sq_meter", status: "draft" },
      ],
    },
    {
      id: uuid(), title: "Perimeter fencing — security upgrade",
      status: "pending_approval", requestedBy: "James", daysAgo: 2,
      notes: "300m chain-link perimeter fence with razor wire top. Site security audit requirement.",
      transitions: ["draft", "pending_approval"],
      items: [
        { materialName: "Steel pipe", specification: "2\" Schedule 40 fence posts", quantity: 150, unit: "meter", status: "draft" },
        { materialName: "Steel angle", specification: "40x40x4mm bracing", quantity: 200, unit: "meter", status: "draft" },
        { materialName: "Rebar tie wire", specification: "1.2mm galvanized", quantity: 50, unit: "kg", status: "draft" },
      ],
    },
    {
      id: uuid(), title: "Emergency generator pad — concrete works",
      status: "pending", requestedBy: "admin", approvedBy: "James", daysAgo: 3,
      notes: "6x4m reinforced concrete pad for new 500kVA generator. Urgent — generator delivery in 3 weeks.",
      transitions: ["draft", "pending_approval", "pending"],
      items: [
        { materialName: "Ready-mix concrete", specification: "C35 high-strength", quantity: 8, unit: "cubic_meter", status: "draft" },
        { materialName: "Steel rebar", specification: "16mm Grade 60", quantity: 400, unit: "kg", status: "draft" },
        { materialName: "Portland cement", specification: "Type I", quantity: 20, unit: "bag", status: "draft" },
        { materialName: "Sand (construction)", specification: "fine washed", quantity: 5, unit: "ton", status: "draft" },
      ],
    },
    {
      id: uuid(), title: "Phase 2 warehouse — structural steel order",
      status: "processing", requestedBy: "James", approvedBy: "James", daysAgo: 4,
      notes: "Second phase of warehouse expansion. Must match Phase 1 steel specifications exactly.",
      transitions: ["draft", "pending_approval", "pending", "processing"],
      items: [
        { materialName: "Steel I-beam", specification: "W250x58 ASTM A992", quantity: 60, unit: "meter", status: "sourcing", note: "Agent searching Acme + MetalCo" },
        { materialName: "Steel plate", specification: "12mm hot-rolled", quantity: 800, unit: "kg", status: "sourcing" },
        { materialName: "Steel angle", specification: "75x75x6mm", quantity: 100, unit: "meter", status: "quoted", note: "MetalCo $19/m, 7d lead", selectedVendorId: null, selectedPrice: null },
        { materialName: "Steel pipe", specification: "4\" Schedule 40", quantity: 80, unit: "meter", status: "sourcing" },
      ],
    },
    {
      id: uuid(), title: "Parking lot lighting — LED retrofit",
      status: "processing", requestedBy: "admin", approvedBy: "James", daysAgo: 5,
      notes: "Replace 40 sodium vapor lights with LED across 3 parking areas. Energy audit recommendation.",
      transitions: ["draft", "pending_approval", "pending", "processing"],
      items: [
        { materialName: "LED panel light", specification: "150W floodlight 5000K", quantity: 40, unit: "piece", status: "quoted", note: "WirePro $26/pc, 21d lead" },
        { materialName: "Electrical cable", specification: "4-core 6mm² armored", quantity: 500, unit: "meter", status: "quoted", note: "WirePro $8.50/m" },
        { materialName: "Junction box", specification: "IP66 outdoor", quantity: 40, unit: "piece", status: "selected", selectedVendorId: VID.wirepro, selectedPrice: 12.00, note: "WirePro selected — best price" },
        { materialName: "Cable tray", specification: "galvanized 200mm", quantity: 100, unit: "meter", status: "sourcing" },
        { materialName: "PVC conduit", specification: "32mm heavy duty", quantity: 200, unit: "piece", status: "sourcing" },
      ],
    },
    {
      id: uuid(), title: "Aluminum cladding — facade renovation",
      status: "processing", requestedBy: "James", approvedBy: "admin", daysAgo: 8,
      notes: "Replace damaged cladding on east wing. 800sqm total area. Color: RAL 7016 anthracite grey.",
      transitions: ["draft", "pending_approval", "pending", "processing"],
      items: [
        { materialName: "Aluminum sheet", specification: "3mm RAL 7016 coated", quantity: 850, unit: "sq_meter", status: "selected", selectedVendorId: VID.metalco, selectedPrice: 48.00, note: "MetalCo — only supplier with RAL 7016" },
        { materialName: "Aluminum extrusion", specification: "T-profile mounting rail", quantity: 400, unit: "meter", status: "selected", selectedVendorId: VID.metalco, selectedPrice: 24.00 },
        { materialName: "Stainless steel sheet", specification: "0.5mm backing", quantity: 200, unit: "kg", status: "quoted", note: "MetalCo $30/kg, checking alternatives" },
      ],
      shortlist: [
        { vendorId: VID.metalco, items: [0, 1, 2], prices: [48.00, 24.00, 30.00] },
      ],
    },
    {
      id: uuid(), title: "Q2 safety compliance — PPE & signage",
      status: "processing", requestedBy: "admin", approvedBy: "admin", daysAgo: 6,
      notes: "Annual safety compliance order. Must arrive before May 15 inspection.",
      transitions: ["draft", "pending_approval", "pending", "processing"],
      items: [
        { materialName: "Hard hat", specification: "ANSI Type I white", quantity: 30, unit: "piece", status: "selected", selectedVendorId: VID.safetyplus, selectedPrice: 20.00, note: "SafetyPlus — bulk discount applied" },
        { materialName: "Safety vest", specification: "Class 3 sleeved", quantity: 30, unit: "piece", status: "selected", selectedVendorId: VID.safetyplus, selectedPrice: 11.00 },
        { materialName: "Safety signage set", specification: "OSHA compliant", quantity: 2, unit: "set", status: "selected", selectedVendorId: VID.safetyplus, selectedPrice: 120.00 },
        { materialName: "Fire extinguisher", specification: "ABC 5kg", quantity: 10, unit: "piece", status: "selected", selectedVendorId: VID.safetyplus, selectedPrice: 42.00 },
        { materialName: "First aid kit", specification: "100-person wall-mount", quantity: 2, unit: "piece", status: "selected", selectedVendorId: VID.safetyplus, selectedPrice: 60.00 },
      ],
      shortlist: [
        { vendorId: VID.safetyplus, items: [0, 1, 2, 3, 4], prices: [20.00, 11.00, 120.00, 42.00, 60.00] },
      ],
    },
    {
      id: uuid(), title: "Washroom block B — plumbing materials",
      status: "processing", requestedBy: "James", approvedBy: "James", daysAgo: 10,
      notes: "Extension of washroom renovation. Block B, 2 floors, 8 units per floor.",
      transitions: ["draft", "pending_approval", "pending", "processing"],
      items: [
        { materialName: "PVC pipe", specification: "110mm pressure", quantity: 150, unit: "meter", status: "ordered", selectedVendorId: VID.plumbworks, selectedPrice: 5.50, poNumber: "PO-2026-0087", note: "PlumbWorks — ordered Apr 20" },
        { materialName: "Copper pipe", specification: "15mm Type L", quantity: 200, unit: "meter", status: "ordered", selectedVendorId: VID.plumbworks, selectedPrice: 17.00, poNumber: "PO-2026-0087" },
        { materialName: "Ball valve", specification: "brass 3/4\"", quantity: 32, unit: "piece", status: "selected", selectedVendorId: VID.plumbworks, selectedPrice: 13.50, note: "Awaiting PO bundling" },
        { materialName: "PVC pipe", specification: "50mm waste", quantity: 100, unit: "meter", status: "quoted", note: "PlumbWorks $4.50/m, checking local supplier" },
      ],
      shortlist: [
        { vendorId: VID.plumbworks, items: [0, 1, 2, 3], prices: [5.50, 17.00, 13.50, 4.50] },
      ],
    },
  ];

  await db.transaction(async (tx) => {
    let count = 0;

    for (const pr of ACTIVE_PRS) {
      const createdAt = now - days(pr.daysAgo);

      await tx.execute(
        `INSERT INTO purchase_requests (id, title, status, requested_by, approved_by, deadline, notes, created_at, updated_at)
        VALUES (@id, @title, @status, @requestedBy, @approvedBy, @deadline, @notes, @createdAt, @updatedAt)`,
        {
          id: pr.id, title: pr.title, status: pr.status,
          requestedBy: pr.requestedBy, approvedBy: pr.approvedBy || null,
          deadline: createdAt + days(21), notes: pr.notes,
          createdAt, updatedAt: now,
        }
      );

      // Status log
      let prev = null;
      for (let i = 0; i < pr.transitions.length; i++) {
        await tx.execute(
          `INSERT INTO pr_status_log (pr_id, from_status, to_status, changed_by, reason, created_at)
          VALUES (@prId, @fromStatus, @toStatus, @changedBy, @reason, @createdAt)`,
          {
            prId: pr.id, fromStatus: prev, toStatus: pr.transitions[i],
            changedBy: pr.requestedBy, reason: null,
            createdAt: createdAt + Math.floor(days(pr.daysAgo) * i / pr.transitions.length),
          }
        );
        prev = pr.transitions[i];
      }

      // Line items with per-item status
      const lineItemIds = [];
      for (const item of pr.items) {
        const info = await tx.execute(
          `INSERT INTO pr_line_items (pr_id, material_name, specification, quantity, unit, status, selected_vendor_id, selected_price, po_number, note, created_at)
          VALUES (@prId, @materialName, @specification, @quantity, @unit, @status, @selectedVendorId, @selectedPrice, @poNumber, @note, @createdAt)`,
          {
            prId: pr.id, materialName: item.materialName,
            specification: item.specification, quantity: item.quantity,
            unit: item.unit, status: item.status || "draft",
            selectedVendorId: item.selectedVendorId || null,
            selectedPrice: item.selectedPrice || null,
            poNumber: item.poNumber || null,
            note: item.note || null,
            createdAt,
          }
        );
        lineItemIds.push(Number(info.lastId));
      }

      // Shortlist (for sourced+ PRs)
      if (pr.shortlist) {
        for (const sl of pr.shortlist) {
          for (let i = 0; i < sl.items.length; i++) {
            await tx.execute(
              `INSERT INTO pr_vendor_shortlist (pr_id, vendor_id, line_item_id, reference_price, notes, created_at)
              VALUES (@prId, @vendorId, @lineItemId, @referencePrice, @notes, @createdAt)`,
              {
                prId: pr.id, vendorId: sl.vendorId,
                lineItemId: lineItemIds[sl.items[i]],
                referencePrice: sl.prices[i],
                notes: null, createdAt: now - days(1),
              }
            );
          }
        }
      }

      // RFQ emails (for rfq_sent+ PRs)
      if (pr.rfqs) {
        for (const rfqItem of pr.rfqs) {
          await tx.execute(
            `INSERT INTO rfq_emails (id, pr_id, vendor_id, to_email, status, gmail_thread_id, line_item_ids, sent_at, replied_at, created_at, updated_at)
            VALUES (@id, @prId, @vendorId, @toEmail, @status, @threadId, @lineItemIds, @sentAt, @repliedAt, @createdAt, @updatedAt)`,
            {
              id: uuid(), prId: pr.id, vendorId: rfqItem.vendorId,
              toEmail: VENDORS.find(v => v.id === rfqItem.vendorId)?.email || "unknown@example.com",
              status: rfqItem.status, threadId: uuid(),
              lineItemIds: JSON.stringify(lineItemIds),
              sentAt: now - days(pr.daysAgo - 2), repliedAt: null,
              createdAt: now - days(pr.daysAgo - 1), updatedAt: now,
            }
          );
        }
      }

      count++;
    }
    console.log(`✅ Seeded ${count} active PRs across various statuses.`);
  });

  await db.close();
};

main().catch((err) => {
  process.stderr.write(`[mcp-taskbridge:seed] fatal: ${err.stack || err.message}\n`);
  process.exit(1);
});
