import type { NpcDefinition } from './contracts';

export interface ConversationEnvironment {
  id: string;
  npcId: NpcDefinition['id'];
  title: string;
  japanese: string;
  category: string;
  host: string;
  image: string;
  description: string;
  practice: string[];
}

export const conversationEnvironments: ConversationEnvironment[] = [
  {
    id: 'cafe', npcId: 'cafe_owner', title: 'A coffee in Kyoto', japanese: '喫茶店',
    category: 'Coffee shop', host: 'Aiko', image: '/environments/kyoto-cafe-v1.png',
    description: 'A quiet counter, a warm welcome, and your first order in Japanese.',
    practice: ['Order a coffee', 'Ask for a recommendation', 'Pay politely'],
  },
  {
    id: 'fruit-market', npcId: 'shopkeeper', title: 'Something fresh from the market', japanese: '果物屋',
    category: 'Fruit market', host: 'Mei', image: '/environments/kyoto-fruit-market-v1.png',
    description: 'Seasonal fruit, a friendly local seller, and a little everyday Japanese.',
    practice: ['Choose your fruit', 'Ask the price', 'Pay politely'],
  },
  {
    id: 'restaurant', npcId: 'local_guide', title: 'A table for one, please', japanese: '食事処',
    category: 'Restaurant', host: 'Haru', image: '/environments/kyoto-restaurant-v1.png',
    description: 'Settle into a cosy neighbourhood restaurant and order something delicious.',
    practice: ['Ask for a table', 'Order your meal', 'Ask for the bill'],
  },
];

const neighbourhoodEnvironments: ConversationEnvironment[] = [
  { id: 'walk', npcId: 'guide_practice', title: 'A walk around Kyoto', japanese: '散歩', category: 'Neighbourhood walk', host: 'Haru', image: '/environments/kyoto-garden-v1.png', description: 'Ask a local for directions and confirm your route.', practice: ['Find the temple', 'Ask for directions', 'Confirm the route'] },
  { id: 'inn', npcId: 'inn_host', title: 'A welcome at the inn', japanese: '旅館', category: 'Local inn', host: 'Ren', image: '/environments/kyoto-gift-shop-v1.png', description: 'Check in and ask about your stay.', practice: ['Check in', 'Ask about breakfast', 'Request a towel'] },
  { id: 'tea', npcId: 'market_tea', title: 'A taste of Japanese tea', japanese: 'お茶屋', category: 'Tea stall', host: 'Sora', image: '/environments/kyoto-cafe-v1.png', description: 'Find a tea to take home and learn how to prepare it.', practice: ['Choose a tea', 'Ask the price', 'Buy a gift'] },
];

export function environmentForNpc(npcId: string) {
  return [...conversationEnvironments, ...neighbourhoodEnvironments].find(environment => environment.npcId === npcId) ?? conversationEnvironments[0];
}
