// ============================================================
//  AgriBird Knowledge Base - Generated from Official Brochure
//  Brand: AgriBird | Mfg. by: Satyam Techworks Pvt. Ltd.
// ============================================================

/**
 * Returns the effective knowledge for AI reply generation.
 *
 * - If the user has configured custom company/product information in
 *   Settings, those values are used as-is.
 * - If neither field has content, the built-in AgriBird knowledge base
 *   is used and `restrictToKnowledgeBase` is forced to `true` so the
 *   AI only answers from known product data.
 */
export function getEffectiveKnowledge(settings: {
  companyInformation?: string;
  productCatalogueInformation?: string;
  restrictToKnowledgeBase?: boolean;
  catalogueLink?: string;
}): {
  companyInformation: string;
  productCatalogueInformation: string;
  restrictToKnowledgeBase: boolean;
  catalogueLink: string;
} {
  const hasCustom = Boolean(
    settings.companyInformation?.trim() ||
    settings.productCatalogueInformation?.trim()
  );

  if (hasCustom) {
    return {
      companyInformation: settings.companyInformation ?? "",
      productCatalogueInformation: settings.productCatalogueInformation ?? "",
      restrictToKnowledgeBase: settings.restrictToKnowledgeBase ?? false,
      // Catalogue is sent as a PDF document — never append a text link
      catalogueLink: "",
    };
  }

  // No custom knowledge configured → use built-in AgriBird knowledge base
  return {
    companyInformation: "",
    productCatalogueInformation: agribirdKnowledgeBase,
    restrictToKnowledgeBase: true,
    // Catalogue is sent as a PDF document — never append a text link
    catalogueLink: "",
  };
}

export const agribirdKnowledgeBase = `
=============================================================
COMPANY INFORMATION
=============================================================

Company Name   : AgriBird
Manufactured by: Satyam Techworks Pvt. Ltd. (Since 1996)
Tagline        : "Stronger Yields, Smarter Farming"

Phone    : +91 98793 74112
Email    : support@agribirdindia.com
Website  : www.agribirdindia.com | www.satyamtechworks.com
Address  : R.S. No. 51, Plot No. 32, Nr. CNG Pump,
           Godown Zone, Dared, Jamnagar 361012, Gujarat, INDIA

=============================================================
 ABOUT AGRIBIRD
=============================================================

AgriBird is a pioneering company dedicated to transforming
the farming landscape with advanced farming spray guns. With
over a decade of experience in agricultural equipment,
AgriBird has established itself as a trusted manufacturer of
high-quality spraying tools and accessories.

Product Range: Professional spray guns, pumps, connectors,
and specialized agricultural tools. Every product is
carefully selected and quality-tested to ensure durability
and optimal performance in the field.

Vision : To be a global leader in innovative spraying
         solutions, driving efficiency, sustainability, and
         progress in agriculture and industry.

Mission: To empower farmers and industrial workers with
         reliable, efficient, and durable spraying solutions.

Core Values: Continuous innovation, high-quality materials,
             and rigorous testing for consistent performance
             even in the most demanding conditions.

All products carry: Standard Manufacturing Warranty Included
All products offer: Additional Support on Sales & Marketing

=============================================================
PRODUCT CATALOG
=============================================================

-------------------------------------------------------------
CATEGORY 1: SPRAY GUNS (SS - Stainless Steel Series)
-------------------------------------------------------------

1. SSC161 — 16mm 1ft. SS Ceramic Spray Gun
   - Pipe Size        : 16mm
   - Pipe Length      : 1ft. / 30cm / 300mm
   - Cone Cap         : Orange & Green with 1.5mm Ceramic
   - Pipe & Shaft     : Stainless Steel
   - Thread Connection: 1/2" Male & 14 X 1.5 Female
   - Spray Pattern    : Wide Spray & Long Spray
   - Operation        : Back end lever handle
   - Packing          : Multicolor Laminated Single Piece Box
   - Carton Pack      : 30pcs per Carton

2. SSB161 — 16mm 1ft. SS Jet Spray Gun
   - Pipe Size        : 16mm
   - Pipe Length      : 1ft. / 30cm / 300mm
   - Jet Cap          : Orange & Green with 1.5mm SS Jet
   - Pipe & Shaft     : Stainless Steel
   - Thread Connection: 1/2" Male & 14 X 1.5 Female
   - Spray Pattern    : Wide Spray & Long Spray
   - Operation        : Back end lever handle
   - Packing          : Multicolor Laminated Single Piece Box
   - Carton Pack      : 30pcs per Carton
   - FREE Accessories : 2 Blade & 1 Washer Set

3. SSB192 — 19mm 2ft. SS Jet Spray Gun  [Heavy Duty]
   - Pipe Size        : 19mm (Heavy Duty)
   - Pipe Length      : 2ft. / 60cm / 600mm
   - Jet Cap          : Orange & Green with 1.5mm SS Jet
   - Pipe & Shaft     : Stainless Steel
   - Thread Connection: 1/2" Male & 14 X 1.5 Female
   - Spray Pattern    : Wide Spray & Long Spray
   - Operation        : Back end lever handle
   - Packing          : Multicolor Laminated Single Piece Box
   - Carton Pack      : 30pcs per Carton
   - FREE Accessories : 2 Blade & 1 Washer Set

-------------------------------------------------------------
CATEGORY 2: SPRAY GUNS (BS - Brass Boom Series)
-------------------------------------------------------------

4. BS762 — Boom Spray Nozzle / 76mm Double Nozzle Ceramic Cone Cap Spray Gun
   - Size             : 76mm
   - Material         : Fully Brass (Heavy Duty)
   - Cone Cap         : Orange & Green with 1.5mm Ceramic
   - Nozzle Thread    : 1/2" Male & 14 X 1.5 Female
   - Connector Thread : 1/4" Male
   - Spray Pattern    : Wide Spray & Long Spray
   - Operation        : Back end wing nut
   - Position         : Fixed + 360 Degree Rotating (with connector)
   - Packing          : Multicolor Laminated Single Piece Box
   - Carton Pack      : 60pcs per Carton

5. BS761 — Boom Spray Nozzle / 76mm Ceramic Cone Cap Spray Gun with Connector
   - Size             : 76mm
   - Material         : Fully Brass (Heavy Duty)
   - Cone Cap         : Orange & Green with 1.5mm Ceramic
   - Nozzle Thread    : 1/2" Male & 14 X 1.5 Female
   - Connector Thread : 1/4" Male
   - Spray Pattern    : Wide Spray & Long Spray (Front End)
   - Operation        : Back end wing nut
   - Position         : Fixed + 360 Degree Rotating (with connector)
   - Packing          : Multicolor Laminated Single Piece Box
   - Carton Pack      : 60pcs per Carton

6. BRB162 — 16mm 2ft. Brass Apple Master Jet Spray Gun
   - Pipe             : Fully Brass - 16mm
   - Pipe Length      : 2ft. / 60cm / 600mm
   - Jet Cap          : Fully Brass with 1.5mm SS Jet
   - Shaft Material   : Stainless Steel
   - Thread Connection: 1/2" Male & 14 X 1.5 Female
   - Spray Pattern    : Wide Spray & Long Spray
   - Operation        : Back end lever handle
   - Packing          : Multicolor Laminated Single Piece Box
   - Carton Pack      : 30pcs per Carton
   - FREE Accessories : 2 Blade & 1 Washer Set

-------------------------------------------------------------
CATEGORY 3: SPRAY GUNS (Knapsack Series)
-------------------------------------------------------------

7. KNB45 / KNB60 / KNB90 — Brass Knapsack Spray Gun (45cm, 60cm, 90cm)
   - Pipe Size        : 12.60mm
   - Pipe Length      : 1.5ft./45cm | 2.0ft./60cm | 3.0ft./90cm
   - Jet Cap          : Fully Brass with 1.5mm SS Jet
   - Pipe & Shaft     : Stainless Steel
   - Thread Connection: 14 X 1.5 Female
   - Spray Pattern    : Wide Spray & Long Spray
   - Operation        : Back end lever handle
   - Packing          : Single Piece Bag Packing
   - Carton Pack      : 60pcs per Carton

8. KNA45 / KNA60 / KNA90 — Aluminum Knapsack Spray Gun (45cm, 60cm, 90cm)
   - Pipe Size        : 12.60mm
   - Pipe Length      : 1.5ft./45cm | 2.0ft./60cm | 3.0ft./90cm
   - Jet Cap & Y Conn.: Coated Brass with 1.5mm SS Jet
   - Pipe & Shaft     : Stainless Steel
   - Thread Connection: 14 X 1.5 Female
   - Spray Pattern    : Wide Spray & Long Spray
   - Operation        : Back end lever handle
   - Packing          : Single Piece Bag Packing
   - Carton Pack      : 60pcs per Carton

-------------------------------------------------------------
CATEGORY 4: BRASS STRAIGHT LANCE SERIES
-------------------------------------------------------------

9. BSL45 / BSL60 / BSL90 — Brass Straight Lance (45cm, 60cm, 90cm)
   - Pipe Size        : 12.60mm
   - Pipe Length      : 1.5ft./45cm | 2.0ft./60cm | 3.0ft./90cm
   - Pipe Material    : S.S.
   - Jet Cap          : Fully Brass with 1.5mm SS Jet
   - Front Connection : 14 X 1.5mm Male
   - Back Thread      : 1/2" Male & 14 X 1.5 Female
   - Spray Pattern    : As per the attached Nozzle
   - Operation        : With use of Trigger
   - Packing          : Single Piece Bag Packing
   - Carton Pack      : 60pcs per Carton

10. SLMN 1.5 / SLMN 2.0 / SLMN 3.0 — Brass Straight Lance with Mist Nozzle
    - Pipe Size        : 12.60mm
    - Pipe Length      : 1.5ft./45cm | 2.0ft./60cm | 3.0ft./90cm
    - Pipe Material    : S.S.
    - Jet Cap          : Fully Brass with 1.5mm SS Jet
    - Thread Connection: 1/2" Male & 14 X 1.5 Female
    - Spray Pattern    : Wide Spray & Long Spray using Mist Nozzle
    - Operation        : Back end Round Knob through Mist Nozzle
    - Direct Connection: With Delivery Pipe - No Trigger required
    - Packing          : Single Piece Bag Packing
    - Carton Pack      : 30pcs per Carton

-------------------------------------------------------------
CATEGORY 5: TURBO JET SPRAY GUN SERIES
-------------------------------------------------------------

11. MSN — Brass Mist Nozzle
    - Total Length     : 5.5cm / 55mm
    - Jet Cap          : Fully Brass with 1.5mm SS Jet
    - Shaft Material   : Brass
    - Thread Connection: 14 X 1.5 Female
    - Spray Pattern    : Wide Spray & Long Spray
    - Operation        : Back end Round Knob
    - Packing          : Single Piece Bag Packing
    - Carton Pack      : 250pcs per Carton

12. TSJ161 — 16mm 1ft. S.S. Turbo Jet Spray Gun
    - Pipe Size        : 16mm
    - Pipe Length      : 1ft. / 30cm / 300mm
    - Cone Cap         : Blue with 1.5mm S.S. Blade / Jet
    - Pipe & Shaft     : Stainless Steel
    - Thread Connection: 1/2" Male & 14 X 1.5 Female
    - Other Parts      : Brass & Plastic
    - Spray Pattern    : Wide Spray & Long Spray
    - Operation        : With Clutch - adjustable with Fix Position to Hold Stable Spray
    - Packing          : Multicolor Laminated Single Piece Box
    - Carton Pack      : 30pcs per Carton
    - FREE Accessories : Included

13. TSJ162 — 16mm 2ft. S.S. Turbo Jet Spray Gun
    - Pipe Size        : 16mm
    - Pipe Length      : 2ft. / 60cm / 600mm
    - Cone Cap         : Blue with 1.5mm S.S. Blade / Jet
    - Pipe & Shaft     : Stainless Steel
    - Thread Connection: 1/2" Male & 14 X 1.5 Female
    - Other Parts      : Brass & Plastic
    - Spray Pattern    : Wide Spray & Long Spray
    - Operation        : With Clutch - adjustable with Fix Position to Hold Stable Spray
    - Packing          : Multicolor Laminated Single Piece Box
    - Carton Pack      : 30pcs per Carton

14. TSJL162 — 16mm 2ft. S.S. Turbo Jet Spray Gun - Light Model
    - Pipe Size        : 16mm
    - Pipe Length      : 2ft. / 60cm / 600mm
    - Cone Cap         : Orange with 1.5mm S.S. Blade / Jet
    - Pipe & Shaft     : Stainless Steel
    - Thread Connection: 1/2" Male & 14 X 1.5 Female
    - Other Parts      : Aluminum & Plastic
    - Spray Pattern    : Wide Spray & Long Spray
    - Operation        : With Clutch - adjustable with Fix Position to Hold Stable Spray
    - Packing          : Multicolor Laminated Single Piece Box
    - Carton Pack      : 30pcs per Carton

-------------------------------------------------------------
CATEGORY 6: PVC NOZZLES
-------------------------------------------------------------

15. BNZ3456O — Bend Nozzle Hole 3,4,5,6 - Coin  (1pc)
16. BNZ8P    — Bend Nozzle Hole 8 Hole           (1pc)
17. BIBZ3456O / SMBZ3456O — Big BCN Nozzle 3,4,5,6 Coin & Small BCN Nozzle (1pc)
18. BIBZ8B   — Single Big PVC Nozzle 8 Hole      (1pc)
19. SMZ4Y    — 4 Hole PVC Nozzle                 (10pc)
20. SMZ1W    — Single Hole Mirchi Nozzle          (10pc)

-------------------------------------------------------------
CATEGORY 7: BRASS NOZZLES
-------------------------------------------------------------

21. BRBJN34W — Brass BCN Jumbo Nozzle 3,4 Hole - Coin + 1 Extra Washer (10pc)
22. BRBIN3456W — Brass Big Hole Nozzle 3,4,5,6 Hole - Coin + 1 Extra Washer (10pc)
23. BRSMN34W — Brass Small Hole Nozzle 3,4 Hole - Coin + 1 Extra Washer (10pc)
24. BWFN     — Big Wide Flow Nozzle / Big Kyyara Nozzle   (10pc)
25. SWFN     — Small Wide Flow Nozzle / Small Kyyara Nozzle (10pc)
26. BNMD     — Brass NMD Nozzle                           (10pc)
27. BRGNZ    — Brass Gada Nozzle / Single Hole Nozzle     (10pc)
28. BJN      — Big Jet Nozzle                             (10pc)
29. SJN      — Small Jet Nozzle                           (10pc)

-------------------------------------------------------------
CATEGORY 8: BRASS FITTINGS
-------------------------------------------------------------

30. BHN1  — 1/2 BSP X 1/2 BSP                  (10pc)
31. BHN2  — 1/2 BSP X 3/8 BSP                  (10pc)
32. BHN3  — 1/2 BSP X 1/4 BSP                  (10pc)
33. BC1   — 1/2 X 1/4 CAP                       (10pc)
34. BR1   — 1/2 X 1/4 Reducer                   (10pc)
35. TNN   — Taiwan Nut Nipple Set                (10pc)
36. BJBN8 — Brass 8mm Jointer Butterfly Nut      (10pc)
37. BJB1.2 — Brass 1/2" Jointer Butterfly        (10pc)
38. BTS   — Brass Twister                        (10pc)
39. BHON12 — 12mm Hose Nipple                   (10pc)
40. BHON8  — 8mm Hose Nipple                    (10pc)
41. BNN12  — Nut Nipple 12mm                    (10pc)
42. BNN10  — Nut Nipple 10mm                    (10pc)
43. BNN8   — Nut Nipple 8mm                     (10pc)

-------------------------------------------------------------
CATEGORY 9: OTHER ACCESSORIES
-------------------------------------------------------------

44. BV14   — 1/4" Mini Ball Valve               (10pc)
45. PVTRB  — PVC Trigger                        (10pc)
46. PVCON  — PVC Connector                      (10pc)
47. BCON2  — Brass Connector / 2 Way Connector  (10pc)
48. PVDLP  — Delivery Pipe                      (10pc)

49. LNC40-2 — 2 Nozzle Extendable Lance 40 cms  (1pc)
50. LNC60-2 — 2 Nozzle Extendable Lance 60 cms  (1pc)
51. EXTEL-LN-BND — Extendable Telescopic Lance   (1pc)
52. LN90-BND     — 3ft Lance                    (1pc)
53. STR-LN — Straight Lance 1.5ft / 2.0ft / 3.0ft (1pc)

=============================================================
GENERAL PRODUCT INFORMATION
=============================================================

All Spray Guns & Accessories:
- Brand Marking  : Agribird
- Warranty       : Standard Manufacturing Warranty Included
- Support        : Additional Support on Sales & Marketing
- Quality        : Each product quality-tested for durability
                   and optimal field performance
Common Terms Used:
- "Tikdi" - Stainless Steel Blade or Jet

Common Spray Patterns Available:
- Wide Spray
- Long Spray
- Mist Spray (on mist nozzle models)

Common Thread Sizes Used:
- 1/2" Male, 14 X 1.5 Female (most spray guns)
- 14 X 1.5 Female (knapsack guns)
- 1/4" Male (boom spray connectors)

Materials Used:
- Stainless Steel (pipes, shafts)
- Fully Brass (heavy duty models)
- Aluminum (light models)
- PVC (nozzles, triggers, connectors)
- Ceramic (cone caps on ceramic models)
`;