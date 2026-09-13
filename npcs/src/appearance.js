// Pure appearance data shared by authoring, player creation and room validation.
export const PRESETS = Object.freeze({
  local_guide: { id:'local_guide', name:'Haru', role:'Local guide', hair:'crop', outfit:'jacket', glasses:false, bag:true, height:1.75,
    skin:'#dca477', hairColor:'#463b35', top:'#5c7f89', accent:'#d5af72', trousers:'#455563', shoes:'#353d43' },
  cafe_owner: { id:'cafe_owner', name:'Aoi', role:'Café owner', hair:'bob', outfit:'apron', glasses:false, bag:false, height:1.68,
    skin:'#edbd99', hairColor:'#594338', top:'#bf7865', accent:'#d9bd90', trousers:'#605d53', shoes:'#765343' },
  inn_host: { id:'inn_host', name:'Ren', role:'Inn host', hair:'topknot', outfit:'haori', glasses:true, bag:false, height:1.8,
    skin:'#bc845e', hairColor:'#353d3d', top:'#6b8076', accent:'#b68766', trousers:'#414d53', shoes:'#3c4143' },
});
export const ANIMATIONS = ['Idle','Walk','Run','Wave','Bow','Talk','Listen'];
export const MATERIAL_CHANNELS = { skin:'Skin', hairColor:'Hair', top:'Top', accent:'Accent', trousers:'Trousers', shoes:'Shoes' };

export function validateAppearance(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Appearance must be an object.');
  const config = { ...PRESETS.local_guide, ...input };
  for (const [key, values] of Object.entries({hair:['crop','bob','topknot'], outfit:['jacket','apron','haori']})) {
    if (!values.includes(config[key])) throw new RangeError(`Unknown ${key}: ${config[key]}`);
  }
  for (const key of Object.keys(MATERIAL_CHANNELS)) {
    if (!/^#[0-9a-f]{6}$/i.test(config[key])) throw new TypeError(`${key} must be a six-digit hex colour.`);
  }
  for (const key of ['glasses','bag']) if (typeof config[key] !== 'boolean') throw new TypeError(`${key} must be a boolean.`);
  if (!Number.isFinite(config.height) || config.height < 1.4 || config.height > 2.1) throw new RangeError('Height must be between 1.4 and 2.1 metres.');
  for (const key of ['id','name','role']) if (typeof config[key] !== 'string' || config[key].length > 80) throw new TypeError(`Invalid ${key}.`);
  // Only allow known data fields to survive an imported appearance file.
  return Object.fromEntries(Object.keys(PRESETS.local_guide).map(key=>[key,config[key]]));
}
