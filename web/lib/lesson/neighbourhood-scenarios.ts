import type { Question, Scenario } from './types';

type Exchange = [japanese: string, meaning: string, task: string, answer: string, answerMeaning: string, reading: string, tip: string];
const questions = (rows: Exchange[]): Question[] => rows.map(([japanese, meaning, task, modelAnswer, answerMeaning, reading, tip], index) => ({
  id: `exchange-${index + 1}`, kind: 'roleplay', japanese, meaning, task, modelAnswer, answerMeaning, reading, tip,
}));

export const neighbourhoodScenarios: Scenario[] = [
  { id: 'directions', npcId: 'guide_practice', name: 'Haru', title: 'Find your way around Kyoto', location: '散歩 · Neighbourhood walk',
    description: 'Ask Haru for directions, confirm the route, and practise asking someone to repeat slowly.',
    questions: questions([
      ['こんにちは。何かお探しですか？', 'Hello. Are you looking for something?', 'Ask where the temple is.', 'お寺はどこですか？', 'Where is the temple?', 'Otera wa doko desu ka?', 'どこ asks where a place is.'],
      ['この道をまっすぐ行ってください。', 'Please go straight along this road.', 'Confirm you should go straight.', 'まっすぐですね。', 'Straight ahead, right?', 'Massugu desu ne.', 'まっすぐ means straight ahead.'],
      ['橋の手前を左に曲がってください。', 'Turn left before the bridge.', 'Confirm the left turn before the bridge.', '橋の手前を左ですね。', 'Left before the bridge, right?', 'Hashi no temae o hidari desu ne.', '手前 means before reaching it; 左 is left.'],
      ['お寺はその先にあります。', 'The temple is further along.', 'Ask whether it is far from here.', 'ここから遠いですか？', 'Is it far from here?', 'Koko kara tōi desu ka?', 'ここから means from here.'],
      ['歩いて十分くらいです。', 'It is about ten minutes on foot.', 'Confirm the journey takes ten minutes on foot.', '歩いて十分ですね。', 'Ten minutes on foot, right?', 'Aruite juppun desu ne.', '十分 here is ten minutes, pronounced じゅっぷん.'],
      ['道は分かりましたか？', 'Do you understand the route?', 'Ask Haru to repeat slowly.', 'もう一度、ゆっくりお願いします。', 'Once more, slowly, please.', 'Mō ichido, yukkuri onegaishimasu.', 'ゆっくり means slowly.'],
      ['駅へも行きますか？', 'Will you also go to the station?', 'Say yes and ask where the station is.', 'はい。駅はどこですか？', 'Yes. Where is the station?', 'Hai. Eki wa doko desu ka?', '駅 means station.'],
      ['駅は橋を渡って右です。', 'The station is to the right after crossing the bridge.', 'Confirm crossing the bridge and turning right.', '橋を渡って右ですね。', 'Cross the bridge, then right, correct?', 'Hashi o watatte migi desu ne.', '右 means right; 渡って means cross.'],
      ['地図をお持ちですか？', 'Do you have a map?', 'Say that you have a map on your phone.', 'スマホに地図があります。', 'I have a map on my phone.', 'Sumaho ni chizu ga arimasu.', '地図 is a map.'],
      ['気をつけて行ってくださいね。', 'Take care on your way.', 'Thank Haru for the help.', '教えてくださって、ありがとうございます。', 'Thank you for telling me.', 'Oshiete kudasatte, arigatō gozaimasu.', 'A simple ありがとうございます is also polite.'],
    ]),
  },
  { id: 'inn', npcId: 'inn_host', name: 'Ren', title: 'Check in at the neighbourhood inn', location: '旅館 · Local inn',
    description: 'Check in with Ren, ask about breakfast and Wi-Fi, and learn useful requests for your stay.',
    questions: questions([
      ['いらっしゃいませ。ご予約はありますか？', 'Welcome. Do you have a reservation?', 'Say that you have a reservation.', 'はい、予約しています。', 'Yes, I have a reservation.', 'Hai, yoyaku shite imasu.', '予約 means reservation.'],
      ['ご予約のお名前をお願いします。', 'May I have the name on your reservation?', 'Give a name for the booking; you can invent one.', '田中です。', 'It is Tanaka.', 'Tanaka desu.', 'Use any practice name; no real personal details are needed.'],
      ['何泊のご予定ですか？', 'How many nights will you stay?', 'Say you are staying one night.', '一泊です。', 'One night.', 'Ippaku desu.', '一泊 is one night, pronounced いっぱく.'],
      ['朝食は七時から九時までです。', 'Breakfast is from seven until nine.', 'Confirm breakfast starts at seven.', '朝食は七時からですね。', 'Breakfast starts at seven, right?', 'Chōshoku wa shichiji kara desu ne.', 'から marks the start time; まで marks the end.'],
      ['朝食は一階でお召し上がりください。', 'Please have breakfast on the first floor.', 'Confirm breakfast is on the first floor.', '一階ですね。ありがとうございます。', 'The first floor, right? Thank you.', 'Ikkai desu ne. Arigatō gozaimasu.', '一階 is the first or ground floor in Japan.'],
      ['ほかにご質問はありますか？', 'Do you have any other questions?', 'Ask whether there is Wi-Fi.', 'ワイファイはありますか？', 'Is there Wi-Fi?', 'Waifai wa arimasu ka?', 'ありますか asks whether something is available.'],
      ['はい。パスワードはお部屋にあります。', 'Yes. The password is in your room.', 'Thank Ren and ask for an extra towel.', 'ありがとうございます。タオルをもう一枚お願いします。', 'Thank you. One more towel, please.', 'Arigatō gozaimasu. Taoru o mō ichimai onegaishimasu.', '枚 counts flat things such as towels.'],
      ['タオルをお持ちします。', 'I will bring a towel.', 'Ask what time check-out is.', 'チェックアウトは何時ですか？', 'What time is check-out?', 'Chekkuauto wa nanji desu ka?', '何時 asks what time.'],
      ['チェックアウトは午前十時です。', 'Check-out is at ten in the morning.', 'Confirm check-out is at ten a.m.', '午前十時ですね。', 'Ten a.m., right?', 'Gozen jūji desu ne.', '午前 means a.m.'],
      ['どうぞごゆっくりお過ごしください。', 'Please enjoy your stay.', 'Thank Ren for the welcome.', 'ありがとうございます。お世話になります。', 'Thank you. I appreciate your hospitality.', 'Arigatō gozaimasu. Osewa ni narimasu.', 'お世話になります politely acknowledges someone looking after you.'],
    ]),
  },
  { id: 'tea', npcId: 'market_tea', name: 'Sora', title: 'Choose a Japanese tea', location: 'お茶屋 · Tea stall',
    description: 'Ask Sora about different teas, choose a gift, check the price, and learn how to prepare it.',
    questions: questions([
      ['いらっしゃいませ。どんなお茶をお探しですか？', 'Welcome. What kind of tea are you looking for?', 'Say you are looking for Japanese tea.', '日本のお茶を探しています。', 'I am looking for Japanese tea.', 'Nihon no ocha o sagashite imasu.', 'お茶 means tea.'],
      ['煎茶とほうじ茶があります。', 'We have sencha and hojicha.', 'Ask which tea Sora recommends.', 'おすすめはどちらですか？', 'Which do you recommend?', 'Osusume wa dochira desu ka?', 'どちら asks which of two options.'],
      ['香ばしいほうじ茶がおすすめです。', 'I recommend the fragrant roasted hojicha.', 'Ask to try the hojicha.', 'ほうじ茶を試飲できますか？', 'May I taste the hojicha?', 'Hōjicha o shiin dekimasu ka?', '試飲 means sampling a drink.'],
      ['どうぞ。熱いのでお気をつけください。', 'Here you are. Be careful, it is hot.', 'Thank Sora and say it smells nice.', 'ありがとうございます。いい香りですね。', 'Thank you. It smells nice.', 'Arigatō gozaimasu. Ii kaori desu ne.', '香り means aroma.'],
      ['お味はいかがですか？', 'How does it taste?', 'Say it is delicious.', 'おいしいです。', 'It is delicious.', 'Oishii desu.', 'おいしい describes something tasty.'],
      ['こちらは一袋百グラムです。', 'This bag contains one hundred grams.', 'Ask the price of one bag.', '一袋いくらですか？', 'How much is one bag?', 'Hitofukuro ikura desu ka?', '一袋 counts one bag.'],
      ['一袋千円です。', 'It is one thousand yen per bag.', 'Order one bag politely.', '一袋お願いします。', 'One bag, please.', 'Hitofukuro onegaishimasu.', '千円 means one thousand yen.'],
      ['ご自宅用ですか？贈り物ですか？', 'Is it for home or a gift?', 'Say it is a gift.', '贈り物です。', 'It is a gift.', 'Okurimono desu.', '贈り物 means gift.'],
      ['贈り物用にお包みしますね。', 'I will wrap it as a gift.', 'Thank Sora and ask how to prepare the tea.', 'ありがとうございます。どうやって入れますか？', 'Thank you. How do I prepare it?', 'Arigatō gozaimasu. Dō yatte iremasu ka?', 'どうやって asks how to do something.'],
      ['入れ方を書いた紙もお付けします。', 'I will include written brewing instructions too.', 'Thank Sora and say you will visit again.', 'ありがとうございます。また来ます。', 'Thank you. I will come again.', 'Arigatō gozaimasu. Mata kimasu.', 'また来ます is a friendly way to end a visit.'],
    ]),
  },
];

// Mix speaking practice with comprehension, a phrase completion, and politeness.
const quizzes: Record<string, { meaning: string[]; task: string; fill: string[]; fillTask: string }> = {
  directions: { meaning: ['Go straight', 'Turn right now', 'Wait at the station'], task: 'What direction does Haru give you?', fill: ['右', '左', '下'], fillTask: 'Complete the confirmation: 橋を渡って ____ ですね。' },
  inn: { meaning: ['The booking name', 'Your room number', 'The breakfast time'], task: 'What is Ren asking you for?', fill: ['何時', 'どこ', 'だれ'], fillTask: 'Complete the question: チェックアウトは ____ ですか？' },
  tea: { meaning: ['Sencha and hojicha', 'Coffee and milk', 'Water and juice'], task: 'Which two teas are available?', fill: ['贈り物', '駅', '朝食'], fillTask: 'Complete “It is a gift”: ____ です。' },
};
for (const scenario of neighbourhoodScenarios) {
  const quiz = quizzes[scenario.id];
  Object.assign(scenario.questions[1], { kind: 'meaning', task: quiz.task, options: quiz.meaning, correctIndex: 0 });
  Object.assign(scenario.questions[7], { kind: 'fill', task: quiz.fillTask, options: quiz.fill, correctIndex: 0 });
  Object.assign(scenario.questions[9], { kind: 'politeness', task: `Choose a polite way to thank ${scenario.name} before leaving.`, options: [scenario.questions[9].modelAnswer, '早くして。', 'もういい。'], correctIndex: 0 });
}
