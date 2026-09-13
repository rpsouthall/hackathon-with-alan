import { PRESETS, validateAppearance } from './appearance.js';

// Original residents for the authored Kyoto City venue and market markers.
// Keep identity separate from a player's freely chosen cosmetic configuration.
const resident = (base, patch) => Object.freeze(validateAppearance({ ...base, ...patch }));
export const CITY_PRESETS = Object.freeze({
  ...PRESETS,
  market_produce: resident(PRESETS.cafe_owner, {
    id:'market_produce', name:'Yui', role:'Produce seller', hair:'topknot', height:1.62,
    skin:'#bd865f', hairColor:'#4c4034', top:'#8c9973', accent:'#d6bd8a', trousers:'#5d6853', shoes:'#655747',
  }),
  market_tea: resident(PRESETS.inn_host, {
    id:'market_tea', name:'Sora', role:'Tea seller', hair:'crop', height:1.72,
    skin:'#e1ac81', hairColor:'#746b5b', top:'#6e8982', accent:'#d1bb80', trousers:'#485f5a', shoes:'#54534b',
  }),
  market_fish: resident(PRESETS.cafe_owner, {
    id:'market_fish', name:'Daichi', role:'Fishmonger', hair:'crop', height:1.86,
    skin:'#ba805c', hairColor:'#373f41', top:'#768f9f', accent:'#dfd7bc', trousers:'#4b5d70', shoes:'#3e4a52',
  }),
  market_dango: resident(PRESETS.cafe_owner, {
    id:'market_dango', name:'Momo', role:'Dango seller', height:1.58,
    skin:'#efbe9b', hairColor:'#57403c', top:'#bc8790', accent:'#e4ceb0', trousers:'#76645f', shoes:'#885f55',
  }),
  kissa_aoi_host: resident(PRESETS.cafe_owner, {
    id:'kissa_aoi_host', name:'Nao', role:'Kissa Aoi barista', hair:'crop', glasses:true, height:1.7,
    skin:'#d39c76', hairColor:'#635346', top:'#71877d', accent:'#d8c7a6', trousers:'#64614f', shoes:'#6f594c',
  }),
  ramen_akari_host: resident(PRESETS.cafe_owner, {
    id:'ramen_akari_host', name:'Akira', role:'Ramen chef', hair:'topknot', height:1.79,
    skin:'#d7a079', hairColor:'#403934', top:'#b66e57', accent:'#e0cba5', trousers:'#5d5149', shoes:'#48423d',
  }),
  bookshop_tsuki_host: resident(PRESETS.local_guide, {
    id:'bookshop_tsuki_host', name:'Tsuki', role:'Bookseller', hair:'bob', glasses:true, bag:false, height:1.66,
    skin:'#ecc2a0', hairColor:'#554646', top:'#818496', accent:'#d3b395', trousers:'#56566c', shoes:'#554b57',
  }),
  sakura_bakery_host: resident(PRESETS.cafe_owner, {
    id:'sakura_bakery_host', name:'Hana', role:'Baker', hair:'topknot', height:1.65,
    skin:'#bc865e', hairColor:'#473831', top:'#c99080', accent:'#eedbc0', trousers:'#856d62', shoes:'#785549',
  }),
  izakaya_tomo_host: resident(PRESETS.inn_host, {
    id:'izakaya_tomo_host', name:'Tomo', role:'Izakaya host', hair:'crop', glasses:false, height:1.83,
    skin:'#cf9870', hairColor:'#4a4240', top:'#627889', accent:'#c7a271', trousers:'#3f5261', shoes:'#494b4a',
  }),
  tea_hanami_host: resident(PRESETS.inn_host, {
    id:'tea_hanami_host', name:'Kaede', role:'Tea host', hair:'bob', glasses:false, height:1.69,
    skin:'#e5b38d', hairColor:'#6b5242', top:'#909d7d', accent:'#d4b385', trousers:'#56654f', shoes:'#64584a',
  }),
  market_provisions_host: resident(PRESETS.local_guide, {
    id:'market_provisions_host', name:'Jun', role:'Provisioner', hair:'crop', glasses:true, height:1.76,
    skin:'#ad7753', hairColor:'#4c4840', top:'#a28b64', accent:'#d9b685', trousers:'#686352', shoes:'#585347',
  }),
  restaurant_momiji_host: resident(PRESETS.inn_host, {
    id:'restaurant_momiji_host', name:'Koharu', role:'Restaurant host', hair:'topknot', glasses:false, height:1.73,
    skin:'#e2ac84', hairColor:'#493836', top:'#a86e59', accent:'#dbb47e', trousers:'#694e49', shoes:'#58423c',
  }),
});

/** Identity/appearance lookup without importing Three.js or loading the GLB. */
export function appearanceForNpc(id) {
  return { ...(CITY_PRESETS[id] ?? validateAppearance({ id })) };
}
