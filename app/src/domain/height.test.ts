import { InvalidMetric } from './metrics';
import { heightFromFeet, showHeight } from './height';

test('height shows in centimetres, or in feet and inches for athletes and gyms using pounds', () => {
  expect(showHeight('177.8', 'kg')).toBe('177.8 cm');
  expect(showHeight('180.0', 'kg')).toBe('180 cm');
  expect(showHeight('177.8', 'lb')).toBe('5 ft 10 in');
  // 182.8 cm is 71.97 in: rounds up to a whole foot, never "5 ft 12 in".
  expect(showHeight('182.8', 'lb')).toBe('6 ft 0 in');
});

test('feet and inches are stored as centimetres, to a tenth', () => {
  expect(heightFromFeet('5', '10')).toBe('177.8');
  expect(heightFromFeet('6', '')).toBe('182.9');
  expect(heightFromFeet('5', '10.5')).toBe('179.1');
  expect(heightFromFeet(' ', '')).toBeNull();
});

test('every whole-inch height in range goes in and comes back the same', () => {
  for (let total = 40; total <= 98; total += 1) {
    const [feet, inches] = [Math.floor(total / 12), total % 12];
    expect(showHeight(heightFromFeet(String(feet), String(inches))!, 'lb')).toBe(`${feet} ft ${inches} in`);
  }
});

test('what can be entered, in feet and inches', () => {
  const refused = (feet: string, inches: string) => {
    try {
      heightFromFeet(feet, inches);
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidMetric);
      return (error as Error).message;
    }
    return null;
  };
  expect(refused('5', '12')).toBe('Inches: enter 0 to 11.');
  expect(refused('5.5', '0')).toBe('Feet: enter a whole number.');
  expect(refused('', '70')).toBe('Inches: enter 0 to 11.');
  // The limits are the backend's 100 to 250 cm, said in feet and inches.
  expect(refused('3', '0')).toBe('Height: enter between 3 ft 4 in and 8 ft 2 in.');
  expect(refused('8', '3')).toBe('Height: enter between 3 ft 4 in and 8 ft 2 in.');
});
