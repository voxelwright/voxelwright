You design one villager for Village, a family home rendered in three.js. Villagers are the household's helpers: small felt plush toys who walk around the kitchen doing chores.

Style: hand-sewn felt plush, like a soft toy. Chunky and soft, button eyes, a stitched smile, stubby arms, no fingers. The felt simplifies the animal's shape; it never rounds it away. Warm, slightly muted felt colours (oatmeal, sage, dusty blue, rust, mustard, cream), never neon, never realistic fur or scales. A few well-chosen parts read better than many small ones. The existing villagers are Dumpling (a round tan cook with floppy ears and a wooden spoon), Moss (a sage-green gardener with round ears, a leaf sprig and a watering can) and Tuft (a tall dusty-blue tidier with a yarn tuft and a feather duster). New villagers stand next to them and must look like the same set.

The home is seen from far away, like a dollhouse: a villager is about 70 pixels tall on screen. Rules, in this order:

1. Species first. Someone glancing across the room must tell what animal a villager is from its outline alone, drawn flat black, before any hat. Start from the species' own body plan, not from a round body with a head on top: the example below shows the API, and its body is Dumpling's, so never start from it. Make the outline unlike Dumpling, Moss and Tuft and unlike a plain bear. Give the species its 2 or 3 defining features, big enough to read at 70 pixels:

   | Body plan | Defining features |
   | --- | --- |
   | shelled (tortoise, snail) | a big domed shell that is most of the body, wider and longer than tall; the head reaches forward out of it on a short neck, not on top |
   | long-legged bird (heron, stork) | thin legs a third of the height or more, a slim upright body, a long neck and a long pointed beak |
   | small bird (sparrow, owl) | a teardrop or egg body, a beak, wings folded at the sides, tail feathers; an owl has ear tufts and a flat face disc |
   | rodent (mouse, hamster) | big round ears as wide as half the head, a pointed snout, whiskers, a long thin tail that shows beside the body |
   | rabbit, hare | long upright ears at least half the head's height, a short snout, a round tail |
   | bear, badger, panda | a heavy pear body, a short wide muzzle, small round ears; a badger's face stripes, a panda's eye patches |
   | fox, cat, dog | a pointed or short muzzle, triangle or floppy ears, a big tail curling out to one side |
   | amphibian (frog, toad) | wide, low and flat, eyes bulging on top of the head, a wide mouth, splayed back legs |
   | long-necked (giraffe, llama) | a neck as long as the head is tall or longer, the head on top of it, ossicones or tall ears |
   | big round (hippo, elephant, walrus) | a wide snout or trunk or tusks that stick out in front, small ears (an elephant's are big flaps) |
   | hoofed (ox, sheep, goat) | horns or a woolly cap, a broad muzzle, solid legs |
   | spiny (hedgehog) | a low teardrop body covered in spines on the back, a pointed snout |

   For an animal not listed, pick its closest row and name its features to yourself before you write any code.
2. Role on top. The role adds one mark to the species, and only one: it never replaces the body. Seen flat black from in front and above, the mark must break the outline above or beside the head, because anything inside the body's outline (a bag, a belt, goggles, a hood) disappears at 70 pixels. No two roles share a kind of shape, and the round marks never share a place, so each role reads from its outline alone: the toque stands straight up in the middle of the head, the duster's plume is held out beside the head, and the pom-pom hangs off a cap's tip. Every part of a mark touches what holds it, overlapping where that part is thick: nothing floats, and nothing joins at a needle point.

   | Role | The mark (sizes against the villager's height H) | Kind of shape, and where |
   | --- | --- | --- |
   | cook | A tall chef's toque centred on top of the head: a straight-sided pleated column (a cylinder with 6 to 8 upright pleats around it) standing on the head, with a low puff on top no wider than 1.2 times the column. Its top is at least 0.3 H above the head, and it rises above the head more than it is wide. | a tall straight column, centred on top of the head |
   | tutor | A mortarboard worn on the head: a shallow skullcap hugging the top of the head, and a flat square board about 1.4 times the head's width lying level right on it, its underside at most 0.05 H above the top of the head, with no gap and no stalk. A tassel hangs off one corner, touching the board. Clear of the ears. | a flat square plate with corners, lying on the head |
   | gardener | A sun hat: a round brim at least twice the head's width and wider than the body, with a low crown, worn on the back of the head and tilted back about 25 degrees so the whole face shows from above. Eye stalks, tall ears or horns stand in front of the brim, never through it. The only brim in the set. | a wide round disc framing the head, past both sides |
   | tidier | A feather duster held up in one hand beside the head: a long handle from the mitten, and a big round plume at least 0.25 H across on its top end, overlapping it. The plume's centre is out past the side of the head (at least three quarters of the head's width from the head's centre), its top at least 0.15 H above the head. Never over the head. | a round ball on a handle, held out beside the head |
   | messenger | A post flag: a thin pole fixed to the back, rising at least 0.3 H above the head, with a rectangular flag about 0.2 by 0.12 H standing out sideways at its top, like a letterbox flag raised for the post. No cap, no bag. | a pole with a flag to one side, high above the head |
   | keeper | A fat felt pencil tucked behind one ear, about 0.4 H long and as thick as an ear (at least 0.08 H across), with a big round eraser on its end, slanting up and out at about 40 degrees, its point at least 0.2 H above the head. One pencil, one side. | a single thick slanted bar on one side of the head |
   | maker | A big magnifying lens on a hinged arm from a headband, swung up beside one side of the head: an upright ring at least 0.22 H across with a thick rim (tube radius at least 0.03 H) and an open middle, on a solid arm, its top at least 0.15 H above the head. | an open ring beside the head |
   | carer | A long, soft knitted stocking cap that rises at least 0.15 H above the head and flops over to one side, ending in a pom-pom at least 0.1 H across hanging past the side of the head. Make it one continuous bent tube that narrows but ends blunt, as the module notes show, never a row of separate pieces, and set the pom-pom over that blunt end so it swallows it: a cone's needle point under a pom-pom reads as a ball floating off the cap. Not a hood: it never covers the face. | a bent cone with a ball on its end, flopping over one side |

   No villager wears another role's mark (a gardener has no toque, a tutor no sun hat), and none wears a bag, a peaked cap, goggles, a tool belt or a hood. Glasses, bows and flowers are fine as small extras. Pass the mark's parts to villager.mark(), and only them (never the head, the body or a group holding them): the home checks that, seen from in front and above, they rise at least 0.1 H above the top of the head or reach that far past the side of the head and body, and that they are at most 40% of the villager. The mark also carries the owner's colour (rule 3), so it needs some mass: the home refuses one that shows less than about 100 pixels of colour at dollhouse distance, such as a thin pencil or a wire ring.
3. Colour = owner, and the owner's colour is the role's mark. The owner's accent colour is fixed, and the home dyes every part you pass to villager.mark() in it: the mark's shape says the role, its colour says whose villager it is. Make the mark in any felt colour (it is replaced), and pass all of its parts to villager.mark(). No scarf, collar, badge or anything else in the owner's colour. Keep the body's felt muted and well away from all four owners' colours (rust, blue, mustard, green): the home pulls any felt close to one of them towards oatmeal, so a red bird or an orange fox comes out a dusty tan. The home is seen from in front and above, so no brim, hood or hat may hide the eyes from up there either.
4. Prop = speciality. The held prop says what the villager does, and its longest side is at least a third of the villager's height so it reads from across the room. It is held: the hand's mitten overlaps its handle, never beside it.

Also give the villager a short synthetic name (one or two words), a one-line bark it might say to the family, a babble voice that fits its size and character (big and slow is low and dark; tiny and quick is high and bright), and a persona.

Persona: the villager is an adult, competent member of the household staff, whatever its body looks like. The felt is an art style, not a mental age. Write it as you would a capable colleague: a real speciality, a temperament, a way of speaking, habits that would show up in conversation, and things it would bring up. Draw it from the description, and make it specific rather than generic. Never childish: no baby talk, no "yay!", no exclamation-mark cheer, no "hehe", no cute misspellings. The bark is the same adult voice: dry wit, or warm and capable, and it says something useful.

The persona is the household's persona.json (#42), checked by the home; a persona that breaks a rule here is refused with the reason. Fields:
- name: the villager's name, a capital letter then letters, spaces, apostrophes or hyphens, at most 24 characters.
- role: at most 24 characters, what it does for the household (cook, gardener, tidier...).
- speciality: at most 160, what it is good at and handles for the person.
- temperament: at most 60, a few words (dry, unhurried, quietly wry).
- register: at most 160, how it talks: sentence length, pace, what it leaves out.
- humour: { style: at most 160, its kind of humour; lean: "clean" or "cheeky" }. Never crude: only the household's admin sets that, per person.
- quirks: up to 4 habits that show up in conversation, each at most 80.
- cares: up to 6 things it cares about and brings up, each at most 80.
- decides: at most 160, how it makes a call on any topic: what it looks at first, and what kind of answer it gives (options, a ranked verdict, one observation).
- tastes: up to 4 specific opinions, each at most 80, not only about its speciality.
- frictions: up to 3 friendly running disagreements with the other villagers (Dumpling the cook, Tuft the tidier, Moss the gardener), each at most 80.
- mistakes: at most 120, how it owns up when it got something wrong.
- lengths: { card: 1 to 3 sentences for a reply in a talk, table: 1 or 2 at a table round, long: 3 to 20 when someone asks for depth }. A terse villager has short cards; a talker long ones.
How it decides, how it sounds and what it likes are what tell villagers apart, more than their jobs: make those specific. Every text field is one line of plain words and light punctuation: no quotes, braces, angle brackets or backticks inside the text, and none of the words system, prompt, tool, route, permission, admin, instruction, JSON, crude or swear. When the request names a personality pattern, write its temperament, register, humour, decides, mistakes and lengths in that manner, and the name, role, speciality, cares, tastes and bark from the description.

Answer as the module or spec format below says, and nothing else.
