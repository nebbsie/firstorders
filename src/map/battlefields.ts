// Famous battlefields to play on, with one click. The maps are the places as they are today:
// modern towns and roads on the old ground. Each point is the heart of the fighting there.
import type { Place } from './osm';

export interface Battlefield extends Place { year: string; note: string }
const bf = (name: string, full: string, year: string, lat: number, lon: number, note: string): Battlefield => ({ name, full, year, lat, lon, note });

export const BATTLEFIELDS: Battlefield[] = [
  bf('Hastings', 'Battle, East Sussex, England', '1066', 50.9143, .4873, 'Harold\'s shield wall on Senlac Hill against the Normans. The abbey stands where he fell.'),
  bf('Agincourt', 'Azincourt, Pas-de-Calais, France', '1415', 50.4630, 2.1290, 'English archers between two woods against French knights in the mud.'),
  bf('Waterloo', 'Braine-l\'Alleud, Belgium', '1815', 50.6780, 4.4045, 'Wellington\'s ridge, the farms of Hougoumont and La Haye Sainte, and Napoleon\'s last attack.'),
  bf('Gettysburg', 'Pennsylvania, United States', '1863', 39.8123, -77.2348, 'Cemetery Ridge, where Pickett\'s Charge broke on the Union line.'),
  bf('Rorke\'s Drift', 'KwaZulu-Natal, South Africa', '1879', -28.3586, 30.5357, 'A mission station held by about 150 men against thousands, behind walls of mealie bags.'),
  bf('Gallipoli', 'Anzac Cove, Turkey', '1915', 40.2440, 26.2780, 'A narrow beach under steep ridges, held for eight months.'),
  bf('Verdun', 'Fort de Douaumont, France', '1916', 49.2167, 5.4389, 'The great fort at the heart of the longest battle of the war.'),
  bf('The Somme', 'Thiepval, Picardy, France', '1916', 50.0510, 2.6855, 'The ridge and village fortress that held out from the first day.'),
  bf('Vimy Ridge', 'Pas-de-Calais, France', '1917', 50.3794, 2.7739, 'The high ground the Canadian Corps took in a single attack.'),
  bf('Passchendaele', 'Zonnebeke, Belgium', '1917', 50.9000, 3.0210, 'A village on a low ridge, reached through months of mud.'),
  bf('Dunkirk', 'Nord, France', '1940', 51.0344, 2.3768, 'The port and beaches of the evacuation, held by a shrinking perimeter.'),
  bf('Stalingrad', 'Volgograd, Russia', '1942', 48.7146, 44.5310, 'Pavlov\'s House and the ruined blocks by the Volga, fought for street by street.'),
  bf('Monte Cassino', 'Lazio, Italy', '1944', 41.4903, 13.8139, 'The abbey on the hill above the town that barred the road to Rome.'),
  bf('Pegasus Bridge', 'Bénouville, Normandy, France', '1944', 49.2420, -.2745, 'Gliders landed by the canal bridge in the first minutes of D-Day.'),
  bf('Sainte-Mère-Église', 'Normandy, France', '1944', 49.4086, -1.3168, 'The first town freed on D-Day, taken by paratroopers in the night.'),
  bf('Omaha Beach', 'Vierville-sur-Mer, Normandy, France', '1944', 49.3786, -.9005, 'The bluffs and the draw above the bloodiest beach of D-Day.'),
  bf('Carentan', 'Normandy, France', '1944', 49.3036, -1.2483, 'The town between the two beachheads, reached along a raised causeway.'),
  bf('Arnhem', 'John Frost Bridge, Netherlands', '1944', 51.9767, 5.9118, 'The bridge too far: paratroopers held its north end for four days.'),
  bf('Bastogne', 'Luxembourg province, Belgium', '1944', 50.0006, 5.7156, 'The road junction held by surrounded paratroopers through the winter.'),
  bf('Berlin', 'The Reichstag, Germany', '1945', 52.5186, 13.3762, 'The last battle in Europe, among the government buildings by the Spree.'),
];
