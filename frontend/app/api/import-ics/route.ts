import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import ICAL from 'ical.js';

/**
 * API route for importing ICS calendar files.
 * Parses the uploaded ICS file, filters events to next 30 days,
 * and inserts them into the user's events in Supabase.
 * 
 * POST /api/import-ics
 * Body: FormData with 'file' field containing the .ics file
 */
export async function POST(request: NextRequest) {
  try {
    // Authenticate the user
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    // Return 401 if not authenticated
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Parse the multipart form data to get the file
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    // Validate that a file was provided
    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Validate file type (must be .ics)
    if (!file.name.toLowerCase().endsWith('.ics')) {
      return NextResponse.json(
        { error: 'Invalid file type. Please upload an .ics file.' },
        { status: 400 }
      );
    }

    // Read the file content as text
    const fileContent = await file.text();

    // Parse the ICS file using ical.js
    let jcalData;
    try {
      jcalData = ICAL.parse(fileContent);
    } catch (parseError) {
      console.error('ICS parse error:', parseError);
      return NextResponse.json(
        { error: 'Failed to parse ICS file. The file may be malformed.' },
        { status: 400 }
      );
    }

    // Create ICAL Component from parsed data
    const comp = new ICAL.Component(jcalData);
    
    // Get all VEVENT components from the calendar
    const vevents = comp.getAllSubcomponents('vevent');

    // Calculate date range: today to 30 days from now
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thirtyDaysFromNow = new Date(today);
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    // Array to hold events that will be inserted
    const eventsToInsert: {
      name: string;
      description: string | null;
      start: string;
      end: string | null;
      owner: string;
    }[] = [];

    // Process each VEVENT
    for (const vevent of vevents) {
      const event = new ICAL.Event(vevent);

      // Skip events without a start time
      if (!event.startDate) {
        continue;
      }

      // Convert ICAL time to JavaScript Date
      const startDate = event.startDate.toJSDate();

      // Filter: only include events within the next 30 days
      if (startDate < today || startDate > thirtyDaysFromNow) {
        continue;
      }

      // Get end date (or calculate from duration, or default to 1 hour after start)
      let endDate: Date | null = null;
      if (event.endDate) {
        endDate = event.endDate.toJSDate();
      } else if (event.duration) {
        // If duration exists, calculate end from start + duration
        const durationSeconds = event.duration.toSeconds();
        endDate = new Date(startDate.getTime() + durationSeconds * 1000);
      } else {
        // Default to 1 hour duration
        endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
      }

      // Extract event details
      const name = event.summary || 'Untitled Event';
      const description = event.description || null;

      // Add to insert array
      eventsToInsert.push({
        name,
        description,
        start: startDate.toISOString(),
        end: endDate ? endDate.toISOString() : null,
        owner: user.id,
      });
    }

    // If no events to import, return early
    if (eventsToInsert.length === 0) {
      return NextResponse.json({
        success: true,
        imported: 0,
        message: 'No events found within the next 30 days.',
      });
    }

    // Insert events into Supabase in batch
    const { error: insertError } = await supabase
      .from('events')
      .insert(eventsToInsert);

    // Handle insertion errors
    if (insertError) {
      console.error('Supabase insert error:', insertError);
      return NextResponse.json(
        { error: 'Failed to save events to database.' },
        { status: 500 }
      );
    }

    // Return success response with count
    return NextResponse.json({
      success: true,
      imported: eventsToInsert.length,
      message: `Successfully imported ${eventsToInsert.length} event${eventsToInsert.length === 1 ? '' : 's'}.`,
    });

  } catch (error) {
    console.error('Import ICS error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred while importing the calendar.' },
      { status: 500 }
    );
  }
}
