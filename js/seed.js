// Default stores and their route order. Personal starting data (catalog, list, first receipt)
// lives in seed-private.js, which stays on the computer and is not published.

export const STORES = [
  { id: 'rl', name: 'רמי לוי', chain: 'rami-levy', color: '#2456A4', active: true, order: 0,
    route: ['לחם ומאפים', 'קטניות ודגנים', 'שימורים, בישול ואפייה', 'חטיפים ומתוקים', 'משקאות', 'פארם וטיפוח', 'ניקיון ואחזקת הבית', 'נייר וחד־פעמי', 'קפוא ומצונן', 'חלב, ביצים וסלטים', 'בשר, עוף ודגים', 'פירות וירקות', 'שונות'] },
  { id: 'tt', name: 'Ten2Ten', chain: 'ten2ten', color: '#B4521A', active: true, order: 1,
    route: ['פירות וירקות', 'בשר, עוף ודגים', 'חלב, ביצים וסלטים', 'לחם ומאפים', 'קטניות ודגנים', 'שימורים, בישול ואפייה', 'קפוא ומצונן', 'חטיפים ומתוקים', 'משקאות', 'פארם וטיפוח', 'ניקיון ואחזקת הבית', 'נייר וחד־פעמי', 'שונות'] },
  { id: 'ca', name: 'קרפור', chain: 'carrefour', color: '#2E7D8C', active: false, order: 2, route: null },
  { id: 'sh', name: 'שופרסל', chain: 'shufersal', color: '#B0263B', active: false, order: 3, route: null }
];
