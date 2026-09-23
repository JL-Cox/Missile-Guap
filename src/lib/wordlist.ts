/**
 * The words a recovery phrase is made from.
 *
 * Exactly 256. A phrase is six different words from here, in any order: one of
 * about 370 billion possible sets, far more than anyone can guess by typing on
 * a lock screen, which is the only attack this phrase has to stand up to - see
 * src/lib/lock.ts for why.
 *
 * Chosen to be written on paper by a tired person and read back correctly
 * weeks later:
 *
 *   - plain, concrete things you can picture: animals, food, things in a house;
 *   - lowercase a-z only, 3 to 7 letters;
 *   - no sound-alikes that could be written down wrong (no bear/bare,
 *     pear/pair, flower/flour, beach/beech, carrot/carat, creek/creak);
 *   - no words spelled differently in the US and the UK (no harbor, gray);
 *   - nothing that could land badly on a hard day (no needle, no mole);
 *   - no word is the start of another, so "pine" can never be half of
 *     "pineapple".
 *
 * test/lock.test.ts holds the list to the mechanical rules. Changing a word
 * only affects phrases made afterwards: a phrase is stored as a hash of the
 * words themselves, never as positions in this list.
 */
export const WORDS: readonly string[] = [
  'acorn', 'almond', 'anchor', 'apple', 'apron', 'atlas', 'attic', 'badger', 'bagel', 'balloon',
  'bamboo', 'banana', 'banjo', 'barge', 'barn', 'barrel', 'basil', 'basket', 'beaver', 'beetle',
  'bench', 'binder', 'birch', 'biscuit', 'bison', 'blanket', 'bottle', 'bridge', 'brook', 'broom',
  'bubble', 'bucket', 'butter', 'button', 'cabbage', 'cabin', 'cactus', 'camel', 'candle', 'canoe',
  'canyon', 'castle', 'celery', 'chalk', 'cheese', 'cherry', 'chimney', 'cider', 'clam', 'cliff',
  'clock', 'cloud', 'clover', 'coast', 'cocoa', 'compass', 'cookie', 'copper', 'cotton', 'crab',
  'crane', 'crayon', 'cricket', 'curtain', 'cushion', 'daisy', 'delta', 'denim', 'desk', 'dolphin',
  'donkey', 'duck', 'dune', 'eagle', 'easel', 'engine', 'falcon', 'farm', 'feather', 'fence',
  'fern', 'field', 'finch', 'folder', 'forest', 'fossil', 'frog', 'frost', 'garage', 'garden',
  'garlic', 'gecko', 'ginger', 'glacier', 'globe', 'glove', 'goat', 'goose', 'granite', 'grape',
  'guitar', 'hammer', 'hammock', 'hamster', 'harp', 'hawk', 'hazel', 'helmet', 'heron', 'hill',
  'honey', 'igloo', 'island', 'jacket', 'jar', 'jug', 'jungle', 'kettle', 'kitten', 'koala',
  'ladder', 'lagoon', 'lake', 'lamp', 'lantern', 'lemon', 'lettuce', 'library', 'lime', 'linen',
  'lizard', 'lobster', 'lotus', 'magnet', 'mango', 'maple', 'marble', 'market', 'meadow', 'melon',
  'mirror', 'mitten', 'moth', 'mouse', 'muffin', 'mug', 'museum', 'napkin', 'noodle', 'oatmeal',
  'ocean', 'octopus', 'olive', 'onion', 'orbit', 'orchid', 'otter', 'owl', 'oyster', 'paddle',
  'palace', 'pancake', 'panda', 'paper', 'parrot', 'pasta', 'peach', 'peanut', 'pebble', 'pelican',
  'pencil', 'penguin', 'pepper', 'pickle', 'pillow', 'pocket', 'pony', 'popcorn', 'porch', 'potato',
  'prairie', 'pretzel', 'puffin', 'pumpkin', 'puppy', 'puzzle', 'quilt', 'rabbit', 'radio',
  'radish', 'raft', 'raisin', 'raven', 'reef', 'ribbon', 'ridge', 'river', 'robin', 'rocket',
  'roof', 'rope', 'ruby', 'saddle', 'salad', 'salmon', 'satchel', 'sheep', 'shelf', 'shell',
  'shovel', 'silver', 'snail', 'snow', 'sofa', 'soup', 'sparrow', 'spinach', 'spoon', 'spruce',
  'squash', 'stamp', 'station', 'summit', 'swan', 'sweater', 'table', 'teapot', 'ticket', 'tiger',
  'timber', 'toast', 'tomato', 'tower', 'tractor', 'train', 'trout', 'trumpet', 'tulip', 'tunnel',
  'turnip', 'turtle', 'valley', 'velvet', 'village', 'violin', 'waffle', 'wagon', 'wallet',
  'walnut', 'whistle', 'willow', 'window', 'wolf', 'yarn', 'zebra', 'zipper',
];
