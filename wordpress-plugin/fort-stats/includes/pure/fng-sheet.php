<?php
/**
 * The FNG sign-up sheet (a published Google Sheet CSV): parsing and grouping. Port of the stats
 * repo's web/fng_sheet.py. Columns: Timestamp, First Name, Last Name, Email, F3 Name,
 * EH'ed By, Workout Q's F3 Name, AO, Phone Number. Only date, F3 name, EH, AO and Q are kept.
 *
 * @package FortStats
 */

defined( 'ABSPATH' ) || exit;

/** Active, in-region orgs that aren't beatdown AOs (left off the FNG challenge board). */
const FSTATS_NON_AO_ORGS = array( 'Q Source', 'ISS', 'In School Suspension', 'McGospel', 'Coffeeteria', 'The Testament', 'Hanging with Stang', 'La Grama' );

/** The AO column is free text: common spellings → one name. */
const FSTATS_FNG_AO_ALIASES = array(
	'dawn patrol (tue)'  => 'Dawn Patrol',
	'dawn patrol (thur)' => 'Dawn Patrol',
	'dawn patrol (thu)'  => 'Dawn Patrol',
	'dawnpatrol'         => 'Dawn Patrol',
	'6@6'                => '6 @ 6',
	'6-ish at 6-ish'     => '6 @ 6',
	'sole to soul'       => 'Soul to Sole',
	'sweep the leg'      => 'Sweep The Leg',
	'the abyss'          => 'Abyss',
	'block party'        => 'Block Party',
	'blockparty'         => 'Block Party',
	'sharp vac'          => 'Shop Vac',
	'the sweati'         => 'Sweati',
);

/** Trim, collapse whitespace, apply the alias map. */
function fstats_fng_canonical_ao( $raw ) {
	$name = preg_replace( '/(*UCP)\s+/u', ' ', fstats_py_strip( (string) $raw ) );
	if ( '' === $name ) {
		return '';
	}
	return FSTATS_FNG_AO_ALIASES[ mb_strtolower( $name ) ] ?? $name;
}

/** The EH column: trimmed, whitespace collapsed (no aliases yet). */
function fstats_fng_canonical_eh( $raw ) {
	return preg_replace( '/(*UCP)\s+/u', ' ', fstats_py_strip( (string) $raw ) );
}

/**
 * The sheet's CSV → records array( date 'Y-m-d', f3_name, eh, ao, q ), oldest first. Rows
 * without a parseable "M/D/YYYY H:MM:SS" timestamp are skipped.
 */
function fstats_parse_fng_csv( $csv ) {
	$fh = fopen( 'php://temp', 'r+' );
	fwrite( $fh, (string) $csv );
	rewind( $fh );
	$head = fgetcsv( $fh, null, ',', '"', '' );
	$out  = array();
	if ( ! $head ) {
		return $out;
	}
	$head = array_map( 'strval', $head );
	while ( ( $row = fgetcsv( $fh, null, ',', '"', '' ) ) !== false ) {
		if ( array( null ) === $row ) {
			continue; // A blank line.
		}
		$r  = array_combine( $head, array_pad( array_slice( $row, 0, count( $head ) ), count( $head ), '' ) );
		$ts = trim( (string) ( $r['Timestamp'] ?? '' ) );
		if ( ! preg_match( '/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{1,2}):(\d{1,2})$/', $ts, $m ) || ! checkdate( (int) $m[1], (int) $m[2], (int) $m[3] ) || (int) $m[4] > 23 || (int) $m[5] > 59 || (int) $m[6] > 61 ) {
			continue;
		}
		$out[] = array(
			'date'    => sprintf( '%04d-%02d-%02d', $m[3], $m[1], $m[2] ),
			'f3_name' => fstats_py_strip( (string) ( $r['F3 Name'] ?? '' ) ),
			'eh'      => fstats_fng_canonical_eh( $r["EH'ed By"] ?? '' ),
			'ao'      => fstats_fng_canonical_ao( $r['AO'] ?? '' ),
			'q'       => fstats_py_strip( (string) ( $r["Workout Q's F3 Name"] ?? '' ) ),
		);
	}
	fclose( $fh );
	usort( $out, fn( $a, $b ) => strcmp( $a['date'], $b['date'] ) ); // Stable, like Python's sort.
	return $out;
}

function fstats_fng_in_range( array $records, $start, $end ) {
	return array_values( array_filter( $records, fn( $r ) => $r['date'] >= $start && $r['date'] <= $end ) );
}

/** Records (already in a date window) → per-AO rows (ao, count, fngs), most FNGs first. Blank AOs are dropped. */
function fstats_fng_leaderboard_by_ao( array $records ) {
	$groups = array();
	foreach ( $records as $r ) {
		if ( '' === $r['ao'] ) {
			continue;
		}
		$groups[ $r['ao'] ][] = $r;
	}
	$rows = array();
	foreach ( $groups as $ao => $recs ) {
		usort( $recs, fn( $a, $b ) => strcmp( $a['date'], $b['date'] ) );
		$rows[] = array(
			'ao'    => (string) $ao,
			'count' => count( $recs ),
			'fngs'  => array_map(
				fn( $r ) => array( 'date' => $r['date'], 'f3_name' => '' !== $r['f3_name'] ? $r['f3_name'] : '(unnamed)', 'eh' => $r['eh'] ),
				$recs
			),
		);
	}
	usort( $rows, fn( $a, $b ) => $b['count'] <=> $a['count'] ?: strcmp( mb_strtolower( $a['ao'] ), mb_strtolower( $b['ao'] ) ) );
	return $rows;
}
