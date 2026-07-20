/**
 * Unit tests for care-level normalization.
 */

import {
  usTraumaLevelToTier,
  ukClassificationToTier,
  osmHeuristicTier,
  hifldServiceLinesToCaps,
  osmSpecialitiesToCaps,
  careLevelLabel,
  careLevelRoman,
  isPediatricOnly,
  inferCapsFromName,
  inferCapsFromTraumaLevel,
  inferCapsFromClassifiedTier,
} from './careLevel'

describe('usTraumaLevelToTier', () => {
  test('US Level I → tier 4', () => expect(usTraumaLevelToTier(1)).toBe(4))
  test('US Level II → tier 3', () => expect(usTraumaLevelToTier(2)).toBe(3))
  test('US Level III → tier 2', () => expect(usTraumaLevelToTier(3)).toBe(2))
  test('US Level IV → tier 1', () => expect(usTraumaLevelToTier(4)).toBe(1))
  test('US Level V → tier 1', () => expect(usTraumaLevelToTier(5)).toBe(1))
})

describe('ukClassificationToTier', () => {
  test('MTC → tier 4', () => expect(ukClassificationToTier('Major Trauma Centre')).toBe(4))
  test('MTC abbreviation → tier 4', () => expect(ukClassificationToTier('MTC')).toBe(4))
  test('Trauma Unit → tier 2', () => expect(ukClassificationToTier('Trauma Unit')).toBe(2))
  test('Level 1 TU → tier 3', () => expect(ukClassificationToTier('Trauma Unit Level 1')).toBe(3))
  test('LEH → tier 1', () => expect(ukClassificationToTier('Local Emergency Hospital')).toBe(1))
  test('Unknown → tier 1', () => expect(ukClassificationToTier('Community Clinic')).toBe(1))
  // International OSM trauma= values
  test('trauma_centre → tier 4', () => expect(ukClassificationToTier('trauma_centre')).toBe(4))
  test('trauma_center → tier 4', () => expect(ukClassificationToTier('trauma_center')).toBe(4))
  // Level-based healthcare:classification= values
  test('level_1 → tier 4', () => expect(ukClassificationToTier('level_1')).toBe(4))
  test('level 1 → tier 4', () => expect(ukClassificationToTier('level 1')).toBe(4))
  test('level i → tier 4', () => expect(ukClassificationToTier('level i')).toBe(4))
  test('bare "1" → tier 4 (healthcare:level = 1)', () => expect(ukClassificationToTier('1')).toBe(4))
  test('level_2 → tier 3', () => expect(ukClassificationToTier('level_2')).toBe(3))
  test('level ii → tier 3', () => expect(ukClassificationToTier('level ii')).toBe(3))
  test('level_3 → tier 2', () => expect(ukClassificationToTier('level_3')).toBe(2))
})

describe('osmHeuristicTier', () => {
  test('Neuro + surgical + burns → tier 4 (Level I)', () => {
    expect(osmHeuristicTier({
      hasEmergency: true,
      specialities: ['neurosurgery', 'surgical', 'burns'],
      beds: 400,
    })).toBe(4)
  })

  test('Neuro + surgical (no burns/cardio) → tier 4 (Level I) — global Level I indicator', () => {
    // Burns and cardio are almost never tagged in OSM for non-UK/US facilities.
    // Neuro + surgical + A&E is the internationally consistent Level I indicator.
    expect(osmHeuristicTier({
      hasEmergency: true,
      specialities: ['neurosurgery', 'surgery'],
      beds: 300,
    })).toBe(4)
  })

  test('Major trauma speciality → tier 4 (Level I)', () => {
    expect(osmHeuristicTier({
      hasEmergency: true,
      specialities: ['major trauma'],
      beds: 100,
    })).toBe(4)
  })

  test('ER + surgical (any size) → tier 3 (Level II)', () => {
    expect(osmHeuristicTier({
      hasEmergency: true,
      specialities: ['surgical', 'orthopaedics'],
      beds: 50,   // small hospital — still tier 3 because surgical + ER
    })).toBe(3)
  })

  test('ER + >150 beds (no surgical) → tier 3 (Level II)', () => {
    expect(osmHeuristicTier({
      hasEmergency: true,
      specialities: ['cardiology'],
      beds: 200,
    })).toBe(3)
  })

  test('ER only (no specialities, no beds) → tier 2 (Level III) — key UK fix', () => {
    // UK hospitals often have emergency=yes but no speciality/bed tags in OSM.
    // They must not be classified as Level IV — Basic.
    expect(osmHeuristicTier({
      hasEmergency: true,
      specialities: [],
      beds: 0,
    })).toBe(2)
  })

  test('ER + small hospital → tier 2 (Level III)', () => {
    expect(osmHeuristicTier({
      hasEmergency: true,
      specialities: ['cardiology'],
      beds: 80,
    })).toBe(2)
  })

  test('No ER → tier 1 (Level IV)', () => {
    expect(osmHeuristicTier({
      hasEmergency: false,
      specialities: ['general'],
      beds: 200,
    })).toBe(1)
  })

  test('No ER, no specialities → tier 1 (Level IV)', () => {
    expect(osmHeuristicTier({
      hasEmergency: false,
      specialities: [],
      beds: 0,
    })).toBe(1)
  })
})

describe('careLevelLabel', () => {
  test('tier 4 → Level I', () => expect(careLevelLabel(4)).toBe('Level I — Definitive'))
  test('tier 3 → Level II', () => expect(careLevelLabel(3)).toBe('Level II — Major'))
  test('tier 2 → Level III', () => expect(careLevelLabel(2)).toBe('Level III — Intermediate'))
  test('tier 1 → Level IV', () => expect(careLevelLabel(1)).toBe('Level IV — Basic'))
})

describe('careLevelRoman', () => {
  test('tier 4 → I', () => expect(careLevelRoman(4)).toBe('I'))
  test('tier 3 → II', () => expect(careLevelRoman(3)).toBe('II'))
  test('tier 2 → III', () => expect(careLevelRoman(2)).toBe('III'))
  test('tier 1 → IV', () => expect(careLevelRoman(1)).toBe('IV'))
})

describe('isPediatricOnly', () => {
  test('Children\'s hospital name → pediatric only', () => {
    expect(isPediatricOnly("Great Ormond Street Children's Hospital", [])).toBe(true)
  })

  test('Paediatric clinic name → pediatric only', () => {
    expect(isPediatricOnly('Alder Hey Paediatric Hospital', [])).toBe(true)
  })

  test('Children\'s hospital name always pediatric-only even with surgical cap', () => {
    // "surgical" here was inferred from trauma level, not documented adult capability.
    // Name-based detection wins — children's hospitals are never appropriate for adult TCCC.
    expect(isPediatricOnly("Boston Children's Hospital", ['surgical', 'neuro'])).toBe(true)
  })

  test('General hospital with pediatric capability → NOT pediatric only', () => {
    // Has BOTH pediatric AND surgical capabilities — surgical overrides the peds signal
    expect(isPediatricOnly('King\'s Lynn Queen Elizabeth Hospital', ['surgical', 'pediatric'])).toBe(false)
  })

  test('No peds name + pediatric cap only (no surgical) → pediatric only', () => {
    // OSM/HIFLD explicitly marks as pediatric service line, no adult surgical — exclude
    expect(isPediatricOnly('Regional Specialty Clinic', ['pediatric'])).toBe(true)
  })

  test('General trauma center (no peds keyword) → NOT pediatric only', () => {
    expect(isPediatricOnly('Queen Elizabeth Hospital', ['surgical', 'neuro'])).toBe(false)
  })

  test('Sheffield Children\'s Hospital (no surgical) → pediatric only', () => {
    expect(isPediatricOnly("Sheffield Children's Hospital", ['pediatric'])).toBe(true)
  })
})

describe('inferCapsFromName', () => {
  test('neurology in name → neuro cap', () => {
    expect(inferCapsFromName('Royal Neurological Hospital')).toContain('neuro')
  })

  test('neurosurgery in name → neuro cap', () => {
    expect(inferCapsFromName('National Neurosurgery Centre')).toContain('neuro')
  })

  test('burn in name → burns cap', () => {
    expect(inferCapsFromName('Chelsea & Westminster Burns Unit')).toContain('burns')
  })

  test('trauma centre in name → surgical cap', () => {
    expect(inferCapsFromName('King\'s College Major Trauma Centre')).toContain('surgical')
  })

  test('trauma center (US spelling) → surgical cap', () => {
    expect(inferCapsFromName('Vanderbilt University Medical Center Trauma Center')).toContain('surgical')
  })

  test('vascular in name → vascular cap', () => {
    expect(inferCapsFromName('National Vascular Institute')).toContain('vascular')
  })

  test('generic hospital name → no caps inferred', () => {
    expect(inferCapsFromName('Queen Elizabeth Hospital')).toHaveLength(0)
  })

  test('partial burn match does not fire for spurious names', () => {
    // "Osburn" should not match /\bburn/
    expect(inferCapsFromName('Osburn Community Hospital')).not.toContain('burns')
  })
})

describe('inferCapsFromTraumaLevel', () => {
  test('Level I → surgical + neuro', () => {
    const caps = inferCapsFromTraumaLevel(1)
    expect(caps).toContain('surgical')
    expect(caps).toContain('neuro')
  })

  test('Level II → surgical only', () => {
    const caps = inferCapsFromTraumaLevel(2)
    expect(caps).toContain('surgical')
    expect(caps).not.toContain('neuro')
  })

  test('Level III → no inferred caps', () => {
    expect(inferCapsFromTraumaLevel(3)).toHaveLength(0)
  })

  test('null → no inferred caps', () => {
    expect(inferCapsFromTraumaLevel(null)).toHaveLength(0)
  })
})

describe('inferCapsFromClassifiedTier', () => {
  test('tier 4 (Level I / MTC) → surgical + neuro', () => {
    const caps = inferCapsFromClassifiedTier(4)
    expect(caps).toContain('surgical')
    expect(caps).toContain('neuro')
  })

  test('tier 3 (Level II / TU-high) → surgical only', () => {
    const caps = inferCapsFromClassifiedTier(3)
    expect(caps).toContain('surgical')
    expect(caps).not.toContain('neuro')
  })

  test('tier 2 → no inferred caps', () => {
    expect(inferCapsFromClassifiedTier(2)).toHaveLength(0)
  })

  test('tier 1 → no inferred caps', () => {
    expect(inferCapsFromClassifiedTier(1)).toHaveLength(0)
  })

  test('null → no inferred caps', () => {
    expect(inferCapsFromClassifiedTier(null)).toHaveLength(0)
  })

  test('burns is never inferred from tier (no formal designation mandates burns unit)', () => {
    expect(inferCapsFromClassifiedTier(4)).not.toContain('burns')
  })
})

describe('hifldServiceLinesToCaps', () => {
  test('parses neuro, burns, surgical', () => {
    const caps = hifldServiceLinesToCaps('Neurology, Burns Center, Trauma Surgery')
    expect(caps).toContain('neuro')
    expect(caps).toContain('burns')
    expect(caps).toContain('surgical')
  })

  test('empty string → empty caps', () => {
    expect(hifldServiceLinesToCaps('')).toHaveLength(0)
  })
})

describe('osmSpecialitiesToCaps', () => {
  test('semicolon-separated OSM format', () => {
    const caps = osmSpecialitiesToCaps('neurosurgery;burns;cardiothoracic')
    expect(caps).toContain('neuro')
    expect(caps).toContain('burns')
    expect(caps).toContain('cardiothoracic')
  })

  test('deduplicates repeated caps', () => {
    const caps = osmSpecialitiesToCaps('neuro;neurosurgery')
    const neuros = caps.filter(c => c === 'neuro')
    expect(neuros).toHaveLength(1)
  })
})
