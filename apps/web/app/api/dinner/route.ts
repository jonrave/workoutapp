/**
 * POST /api/dinner — photo of ingredients in, dinner suggestion out.
 *
 * A deliberately separate lane from the training engine: this route never
 * touches engine state, events, or the decision path (I1/I2 are about the
 * engine; this is a kitchen utility that happens to live in the same app).
 * The model only ever sees the photo and the optional preferences text.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

export const maxDuration = 120;

const bodySchema = z.object({
  /** Base64 image data, no data-URL prefix. */
  image: z.string().min(1),
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
  preferences: z.string().max(500).optional(),
});

const DinnerSchema = z.object({
  ingredients: z
    .array(z.string())
    .describe('Every distinct food item identified in the photo'),
  suggestion: z.object({
    title: z.string().describe('Name of the recommended dinner'),
    why: z
      .string()
      .describe('One short paragraph: why this is the best pick for taste and nutrition'),
    usedIngredients: z.array(z.string()).describe('Which photographed items it uses'),
    pantryStaplesAssumed: z
      .array(z.string())
      .describe('Basics assumed on hand that are not visible in the photo, e.g. oil, salt'),
    steps: z.array(z.string()).describe('Numbered preparation steps, concise'),
    totalTimeMinutes: z.number().describe('Realistic total prep + cook time'),
    nutritionNotes: z
      .string()
      .describe('Brief note on what the meal delivers nutritionally'),
  }),
  alternatives: z
    .array(z.object({ title: z.string(), summary: z.string() }))
    .describe('Two or three other solid options from the same ingredients'),
});

export type DinnerResult = z.infer<typeof DinnerSchema>;

const SYSTEM = `You are a practical home-cooking assistant. The user sends one photo of
ingredients they have available and wants the single best dinner they can make tonight.

- First identify what is actually visible in the photo. Do not invent items you cannot see.
- Optimize for taste and nutrition together, not one at the other's expense.
- Not everything in the photo needs to be used — pick the combination that makes the best meal.
- Assume common pantry staples (oil, salt, pepper, basic dried herbs/spices) are available,
  and list which ones you assumed.
- Keep the recipe achievable on a weeknight: clear steps, realistic timing, no specialty
  equipment.
- If the photo contains no recognizable food, say so via an empty ingredients list and make
  the suggestion title "No ingredients recognized" with an explanation in "why".`;

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'Dinner suggestions need ANTHROPIC_API_KEY to be configured on the server.' },
      { status: 503 },
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }

  const client = new Anthropic();
  try {
    const response = await client.messages.parse({
      model: 'claude-opus-5',
      max_tokens: 16000,
      output_config: { effort: 'medium', format: zodOutputFormat(DinnerSchema) },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: body.mediaType, data: body.image },
            },
            {
              type: 'text',
              text:
                'What is the best thing I can prepare for dinner with these ingredients? ' +
                'Maximize taste and nutrition. Not everything needs to be used.' +
                (body.preferences ? ` Preferences/constraints: ${body.preferences}` : ''),
            },
          ],
        },
      ],
    });

    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      return NextResponse.json(
        { error: 'The model could not produce a suggestion for this photo. Try another shot.' },
        { status: 502 },
      );
    }
    return NextResponse.json({ result: response.parsed_output });
  } catch (err) {
    return NextResponse.json({ error: `Dinner suggestion failed: ${String(err)}` }, { status: 502 });
  }
}
