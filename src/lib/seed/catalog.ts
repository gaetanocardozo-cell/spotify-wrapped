/**
 * A synthetic music catalog with realistic genre overlap, so the UI can be
 * built and judged before any real listening data has accrued.
 *
 * Genres mirror Spotify's actual tagging style: lowercase, granular, and
 * multiple per artist (which is exactly why genre credit needs weighting).
 */

export interface SeedArtist {
  id: string;
  name: string;
  genres: string[];
  popularity: number;
  followers: number;
  /** Relative listening weight; higher = more of your library. */
  weight: number;
  /** Optional taste-drift: artist gains/loses share over the seeded window. */
  trend?: number;
}

export interface SeedTrack {
  id: string;
  name: string;
  artistId: string;
  featuring?: string[];
  durationMs: number;
  albumId: string;
  popularity: number;
  weight: number;
}

export interface SeedAlbum {
  id: string;
  name: string;
  artistId: string;
  releaseDate: string;
  albumType: "album" | "single" | "compilation";
}

export const SEED_ARTISTS: SeedArtist[] = [
  { id: "ar_bad_bunny",   name: "Bad Bunny",        genres: ["reggaeton", "urbano latino", "trap latino"],       popularity: 98, followers: 84_000_000, weight: 14, trend:  0.9 },
  { id: "ar_karol_g",     name: "KAROL G",          genres: ["reggaeton", "urbano latino", "colombian pop"],     popularity: 94, followers: 47_000_000, weight: 10, trend:  0.5 },
  { id: "ar_tame_impala", name: "Tame Impala",      genres: ["psychedelic rock", "neo-psychedelic", "indie"],    popularity: 85, followers: 12_000_000, weight:  9, trend: -0.4 },
  { id: "ar_radiohead",   name: "Radiohead",        genres: ["alternative rock", "art rock", "permanent wave"],  popularity: 82, followers: 11_000_000, weight:  8, trend: -0.2 },
  { id: "ar_sza",         name: "SZA",              genres: ["r&b", "pop", "neo soul"],                          popularity: 90, followers: 23_000_000, weight:  8, trend:  0.6 },
  { id: "ar_kendrick",    name: "Kendrick Lamar",   genres: ["hip hop", "conscious hip hop", "west coast rap"],  popularity: 93, followers: 32_000_000, weight:  8, trend:  0.3 },
  { id: "ar_fkatwigs",    name: "FKA twigs",        genres: ["art pop", "alternative r&b", "electronic"],        popularity: 70, followers:  2_100_000, weight:  5, trend:  0.4 },
  { id: "ar_bonobo",      name: "Bonobo",           genres: ["downtempo", "electronic", "trip hop"],             popularity: 72, followers:  1_800_000, weight:  6, trend:  0.1 },
  { id: "ar_caribou",     name: "Caribou",          genres: ["electronic", "indietronica", "downtempo"],         popularity: 68, followers:  1_100_000, weight:  5, trend:  0.2 },
  { id: "ar_rosalia",     name: "ROSALÍA",          genres: ["flamenco pop", "spanish pop", "art pop"],          popularity: 86, followers:  9_500_000, weight:  6, trend:  0.7 },
  { id: "ar_frank_ocean", name: "Frank Ocean",      genres: ["r&b", "neo soul", "alternative r&b"],              popularity: 87, followers: 18_000_000, weight:  6, trend: -0.1 },
  { id: "ar_bjork",       name: "Björk",            genres: ["art pop", "electronic", "experimental"],           popularity: 66, followers:  2_400_000, weight:  3, trend: -0.3 },
  { id: "ar_khruangbin",  name: "Khruangbin",       genres: ["psychedelic soul", "funk", "thai funk"],           popularity: 74, followers:  2_000_000, weight:  5, trend:  0.5 },
  { id: "ar_mac_miller",  name: "Mac Miller",       genres: ["hip hop", "jazz rap", "pop rap"],                  popularity: 84, followers: 12_000_000, weight:  5, trend: -0.5 },
  { id: "ar_sufjan",      name: "Sufjan Stevens",   genres: ["indie folk", "chamber pop", "singer-songwriter"],  popularity: 71, followers:  1_600_000, weight:  4, trend: -0.6 },
  { id: "ar_arca",        name: "Arca",             genres: ["experimental", "electronic", "deconstructed club"],popularity: 58, followers:    600_000, weight:  2, trend:  0.8 },
  { id: "ar_jorja",       name: "Jorja Smith",      genres: ["r&b", "uk r&b", "neo soul"],                       popularity: 76, followers:  4_200_000, weight:  4, trend:  0.2 },
  { id: "ar_four_tet",    name: "Four Tet",         genres: ["electronic", "folktronica", "idm"],                popularity: 69, followers:  1_300_000, weight:  4, trend:  0.3 },
  { id: "ar_mitski",      name: "Mitski",           genres: ["indie rock", "art pop", "singer-songwriter"],      popularity: 79, followers:  4_800_000, weight:  4, trend:  0.6 },
  { id: "ar_aphex",       name: "Aphex Twin",       genres: ["idm", "electronic", "ambient"],                    popularity: 64, followers:  1_500_000, weight:  3, trend: -0.2 },
  { id: "ar_silvana",     name: "Silvana Estrada",  genres: ["latin folk", "mexican indie", "singer-songwriter"],popularity: 60, followers:    450_000, weight:  3, trend:  0.9 },
  { id: "ar_nina_simone", name: "Nina Simone",      genres: ["jazz", "soul", "vocal jazz"],                      popularity: 75, followers:  5_100_000, weight:  3, trend:  0.0 },
  { id: "ar_floating",    name: "Floating Points",  genres: ["electronic", "jazz fusion", "downtempo"],          popularity: 62, followers:    700_000, weight:  3, trend:  0.4 },
  { id: "ar_the_smile",   name: "The Smile",        genres: ["art rock", "alternative rock", "experimental"],    popularity: 67, followers:    900_000, weight:  3, trend:  0.7 },
];

const TRACK_NAMES: Record<string, string[]> = {
  ar_bad_bunny:   ["Mónaco", "Where She Goes", "Tití Me Preguntó", "Vete", "Un Verano Sin Ti", "Ojitos Lindos", "Después de la Playa"],
  ar_karol_g:     ["PROVENZA", "TQG", "MAÑANA SERÁ BONITO", "Gatúbela", "Mientras Me Curo del Cora", "X SI VOLVEMOS"],
  ar_tame_impala: ["Let It Happen", "The Less I Know the Better", "Borderline", "Eventually", "New Person, Same Old Mistakes", "Feels Like We Only Go Backwards"],
  ar_radiohead:   ["Weird Fishes/Arpeggi", "Everything in Its Right Place", "Reckoner", "Idioteque", "Nude", "Let Down"],
  ar_sza:         ["Kill Bill", "Snooze", "Good Days", "Nobody Gets Me", "Saturn", "Broken Clocks"],
  ar_kendrick:    ["Money Trees", "HUMBLE.", "Alright", "N95", "Sing About Me", "Bitch, Don't Kill My Vibe"],
  ar_fkatwigs:    ["cellophane", "Two Weeks", "sad day", "home with you", "Eusexua"],
  ar_bonobo:      ["Kerala", "Cirrus", "Black Sands", "Linked", "Otomo", "Kiara"],
  ar_caribou:     ["Odessa", "Can't Do Without You", "Never Come Back", "Sun", "Home"],
  ar_rosalia:     ["MALAMENTE", "DESPECHÁ", "LA FAMA", "SAOKO", "BIZCOCHITO", "HENTAI"],
  ar_frank_ocean: ["Nights", "Pink + White", "Self Control", "Ivy", "Nikes", "Solo"],
  ar_bjork:       ["Hyperballad", "Jóga", "Army of Me", "Unravel"],
  ar_khruangbin:  ["Maria También", "August 10", "Time (You and I)", "White Gloves", "So We Won't Forget"],
  ar_mac_miller:  ["Good News", "Self Care", "Come Back to Earth", "2009", "What's the Use?"],
  ar_sufjan:      ["Mystery of Love", "Should Have Known Better", "Death with Dignity", "Fourth of July"],
  ar_arca:        ["Nonbinary", "Time", "KLK", "Prada"],
  ar_jorja:       ["Blue Lights", "Little Things", "On My Mind", "Be Honest"],
  ar_four_tet:    ["Baby", "Two Thousand and Seventeen", "Only Human", "Teenage Birdsong"],
  ar_mitski:      ["My Love Mine All Mine", "Nobody", "Washing Machine Heart", "Your Best American Girl"],
  ar_aphex:       ["Xtal", "Avril 14th", "Windowlicker", "#3"],
  ar_silvana:     ["Marchita", "Te Guardo", "Casa", "Tristeza"],
  ar_nina_simone: ["Feeling Good", "Sinnerman", "I Put a Spell on You", "Ne Me Quitte Pas"],
  ar_floating:    ["Silhouettes", "Movement 6", "LesAlpx", "Last Bloom"],
  ar_the_smile:   ["Thin Thing", "You Will Never Work in Television Again", "Wall of Eyes", "Bending Hectic"],
};

const ALBUM_NAMES: Record<string, string> = {
  ar_bad_bunny: "nadie sabe lo que va a pasar mañana",
  ar_karol_g: "MAÑANA SERÁ BONITO",
  ar_tame_impala: "Currents",
  ar_radiohead: "In Rainbows",
  ar_sza: "SOS",
  ar_kendrick: "good kid, m.A.A.d city",
  ar_fkatwigs: "MAGDALENE",
  ar_bonobo: "Migration",
  ar_caribou: "Our Love",
  ar_rosalia: "MOTOMAMI",
  ar_frank_ocean: "Blonde",
  ar_bjork: "Post",
  ar_khruangbin: "Con Todo El Mundo",
  ar_mac_miller: "Circles",
  ar_sufjan: "Carrie & Lowell",
  ar_arca: "KiCk i",
  ar_jorja: "Lost & Found",
  ar_four_tet: "Sixteen Oceans",
  ar_mitski: "The Land Is Inhospitable...",
  ar_aphex: "Selected Ambient Works 85-92",
  ar_silvana: "Marchita",
  ar_nina_simone: "I Put a Spell on You",
  ar_floating: "Crush",
  ar_the_smile: "Wall of Eyes",
};

/** Deterministic pseudo-random in [0,1) from a string seed. */
function hashUnit(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export function buildCatalog(): {
  artists: SeedArtist[];
  albums: SeedAlbum[];
  tracks: SeedTrack[];
} {
  const albums: SeedAlbum[] = [];
  const tracks: SeedTrack[] = [];

  for (const artist of SEED_ARTISTS) {
    const albumId = `al_${artist.id.slice(3)}`;
    albums.push({
      id: albumId,
      name: ALBUM_NAMES[artist.id] ?? `${artist.name} LP`,
      artistId: artist.id,
      releaseDate: `20${15 + Math.floor(hashUnit(artist.id) * 9)}-0${1 + Math.floor(hashUnit(artist.id + "m") * 9)}-15`,
      albumType: "album",
    });

    const names = TRACK_NAMES[artist.id] ?? [];
    names.forEach((name, i) => {
      const u = hashUnit(artist.id + name);
      // Occasional feature credit, so track_artists is exercised.
      const featuring =
        u > 0.88
          ? [SEED_ARTISTS[(SEED_ARTISTS.findIndex((a) => a.id === artist.id) + 3) % SEED_ARTISTS.length].id]
          : undefined;
      tracks.push({
        id: `tr_${artist.id.slice(3)}_${i}`,
        name,
        artistId: artist.id,
        featuring: featuring?.filter((f) => f !== artist.id),
        durationMs: Math.round(120_000 + u * 240_000),
        albumId,
        popularity: Math.round(40 + u * 55),
        // Zipf-ish: early tracks in the list are the hits.
        weight: (names.length - i) / names.length + u * 0.35,
      });
    });
  }

  return { artists: SEED_ARTISTS, albums, tracks };
}
