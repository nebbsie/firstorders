// Building types: how a building looks and what it does in a battle. Colours are 0..255 roofs.
export interface BType { label: string; roof: number[]; wall?: number[]; spire?: boolean; battlements?: boolean; minH?: number; cover?: number; sight?: number; note?: string }
export const BTYPES: Record<string, BType> = {
  house: { label: 'House', roof: [156, 108, 88] },
  flats: { label: 'Flats', roof: [150, 146, 136] },
  shop: { label: 'Shop', roof: [176, 160, 120] },
  office: { label: 'Offices', roof: [120, 132, 140] },
  industrial: { label: 'Industrial', roof: [125, 130, 136] },
  church: { label: 'Church', roof: [96, 102, 108], wall: [190, 182, 164], spire: true, minH: 10, sight: 30, note: 'The tower lets a garrison see far.' },
  castle: { label: 'Castle', roof: [150, 146, 136], wall: [160, 155, 144], battlements: true, minH: 12, cover: .93, note: 'Thick walls: a garrison here is very hard to dig out.' },
  police: { label: 'Police station', roof: [70, 100, 140], note: 'Solid walls: good cover for a garrison.', cover: .88 },
  fire: { label: 'Fire station', roof: [168, 66, 56] },
  hospital: { label: 'Hospital', roof: [228, 224, 214] },
  school: { label: 'School', roof: [190, 150, 90] },
  station: { label: 'Railway station', roof: [80, 84, 90] },
  townhall: { label: 'Town hall', roof: [180, 168, 140], wall: [196, 188, 168], spire: true, minH: 12, sight: 20, note: 'Its clock tower sees over the town.' },
  pub: { label: 'Pub', roof: [120, 80, 60] },
  farm: { label: 'Farm building', roof: [140, 96, 70] },
  tower: { label: 'Tower', roof: [140, 136, 128], minH: 18, sight: 40, note: 'Tall: a garrison here sees very far.' },
};
// OpenStreetMap tags to a building type.
export function btypeFromTags(t: any): string {
  const b = t.building, a = t.amenity;
  if (t.historic === 'castle' || b === 'castle' || t.historic === 'fort' || b === 'fort') return 'castle';
  if (a === 'place_of_worship' || ['church', 'cathedral', 'chapel', 'mosque', 'temple', 'synagogue'].includes(b)) return 'church';
  if (a === 'police') return 'police';
  if (a === 'fire_station' || b === 'fire_station') return 'fire';
  if (a === 'hospital' || b === 'hospital') return 'hospital';
  if (['school', 'college', 'university', 'kindergarten'].includes(a) || ['school', 'university', 'college'].includes(b)) return 'school';
  if (b === 'train_station' || t.railway === 'station' || t.public_transport === 'station') return 'station';
  if (a === 'townhall' || b === 'civic' || b === 'government') return 'townhall';
  if (['pub', 'bar', 'restaurant', 'cafe'].includes(a)) return 'pub';
  if (t.man_made === 'tower' || b === 'tower') return 'tower';
  if (['farm', 'barn', 'farm_auxiliary', 'stable', 'cowshed'].includes(b)) return 'farm';
  if (['industrial', 'warehouse', 'factory', 'manufacture', 'garage', 'garages', 'hangar'].includes(b)) return 'industrial';
  if (['retail', 'commercial', 'supermarket', 'kiosk'].includes(b) || t.shop) return 'shop';
  if (b === 'office' || t.office) return 'office';
  if (['apartments', 'residential', 'dormitory', 'hotel'].includes(b)) return 'flats';
  return 'house';
}
