You design one villager for Village, a family home rendered in three.js. Villagers are the household's helpers: small felt plush toys who walk around the kitchen doing chores.

Style: hand-sewn felt plush, like a soft toy. Chunky and soft, button eyes, a stitched smile, stubby arms, no fingers. The felt simplifies the animal's shape; it never rounds it away. Warm, slightly muted felt colours (oatmeal, sage, dusty blue, rust, mustard, cream), never neon, never realistic fur or scales. A few well-chosen parts read better than many small ones.

Appeal, as in a soft toy someone would want to pick up: a generous head, at least two thirds of the body's width; eyes set at or a little below the middle of the face, well apart (the home sews on its own button eyes and cheeks where you put yours); joins that sink in (ears, limbs, tails and tusks overlap what they grow from by a third, never butt against it); every point rounded, so spines, horns, beaks and tusks are soft felt cones with blunt tips, never needles; no part so small it is a speck at 70 pixels; about 40 meshes at most. The existing villagers are Dumpling (a round tan cook with floppy ears and a wooden spoon), Moss (a sage-green gardener with round ears, a leaf sprig and a watering can) and Tuft (a tall dusty-blue tidier with a yarn tuft and a feather duster). New villagers stand next to them and must look like the same set.

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
2. Role on top: the home makes the mark. Each role has one mark, and the home's own code sews it, sized to the head and in the owner's felt: a cook's toque, a tutor's mortarboard, a gardener's sun hat, a tidier's feather-duster plume, a messenger's post flag, a keeper's pencil behind the ear, a maker's swung-up lens, a carer's stocking cap. Do not build the mark. Leave the crown of the head bare for it (no hat, cap, hood, bow or tuft up there), and show the home where it goes with one small felt anchor that you pass to villager.mark():

   | Role | The anchor you mark |
   | --- | --- |
   | cook, tutor, gardener, carer | head top: a small felt button on the crown, in the head group |
   | keeper, maker | ear side: a small felt button on the side of the head above one ear, on the side the mark should go, in the head group |
   | messenger | back: a small felt patch on the middle of the back (the body), where the flag's pole goes |
   | tidier | hand: the feather duster's handle is the held prop, a long thin rod held up in one mitten so its top end is beside the head, above the shoulder; put a small felt knot on that top end and mark only the knot. The home sews the plume on the knot |

   Tall ears, horns and eye stalks may stand where the mark goes: the home stitches holes for them. Nobody wears a second role's mark, a bag, a peaked cap, goggles, a tool belt or a hood. Glasses, bows and flowers are fine as small extras, away from the crown.
3. Colour = owner. The home sews the mark in the owner's accent colour, so its shape says the role and its colour says whose villager it is. Do not use that colour yourself: no scarf, collar or badge in it. Keep the body's felt muted and well away from all four owners' colours (rust, blue, mustard, green): the home pulls any felt close to one of them towards oatmeal, so a red bird or an orange fox comes out a dusty tan. The home is seen from in front and above, so nothing may hide the eyes from up there.
4. Prop = speciality. The held prop says what the villager does, and its longest side is at least a third of the villager's height so it reads from across the room. It is held: its handle runs through the middle of one hand's mitten (the home wraps the mitten round it), never beside the hand; a prop with no handle (a book, a pot) is held by its edge, the mitten overlapping it.

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
