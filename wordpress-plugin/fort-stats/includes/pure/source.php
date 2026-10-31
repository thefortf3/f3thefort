<?php
/**
 * Where the stats come from. The payload builders (payload.php) only talk to these interfaces,
 * so they stay pure and testable; includes/rest-source.php implements them over Supabase's REST
 * API, tests/ with stubs.
 *
 * Each method matches the AttendanceDB method of the same name in the stats repo
 * (db/queries.py) and returns the same rows: associative arrays with the same keys, dates as
 * 'YYYY-MM-DD' strings, counts as ints, rounded averages as floats, null for NULL.
 *
 * @package FortStats
 */

defined( 'ABSPATH' ) || exit;

interface FStats_Source {
	/** The region's name ('F3' if unknown). */
	public function region_name(): string;

	/** array( key => array( 'value' => string, 'updated_at' => string ) ) from sync_state. */
	public function sync_status(): array;

	/** The newest $limit months ('YYYY-MM') with any attendance, newest first. */
	public function available_months( int $limit = 24 ): array;

	/** array( workouts, pax_posts, unique_pax, unique_qs ) for a window (inclusive; null = open). */
	public function summary( ?string $start_date = null, ?string $end_date = null ): array;

	/** Rows: user_id, f3_name, total_posts, qs, coqs — most posts first. */
	public function attendance_leaderboard( ?string $start_date = null, ?string $end_date = null, int $top_n = 25 ): array;

	/** Rows: ao_id, ao_name, workouts, pax_posts, unique_pax, avg_pax (float|null) — most posts first. */
	public function ao_breakdown( ?string $start_date = null, ?string $end_date = null ): array;

	/** Rows: ao_id, ao_name, user_id, f3_name, posts, qs, rn — by AO, then most posts. */
	public function ao_top_attendees( int $top_n_per_ao = 15, ?string $start_date = null, ?string $end_date = null ): array;

	/** Rows: ao_id, user_id, f3_name, posts — per AO, the top poster who never Q'd there since $start_date. */
	public function ao_most_posts_no_q( string $start_date ): array;

	/** Rows: month, workouts, pax_posts, unique_pax, fngs — by month. */
	public function monthly_trend( ?string $start_date = null, ?string $end_date = null ): array;

	/** Rows: week ('IYYY-WIW'), workouts, pax_posts — by week. */
	public function weekly_posts( ?string $start_date = null, ?string $end_date = null ): array;

	/** Rows: ao_id, ao_name, month, workouts, pax_posts, unique_pax — by AO, then month. */
	public function ao_monthly_trend( ?string $start_date = null, ?string $end_date = null ): array;

	/**
	 * Rows: event_instance_id, start_date, ao_name, location_name, pax_count, fng_count, title,
	 * backblast (first 1,500 characters), qs (Q handles) — newest first.
	 */
	public function recent_workouts( string $start_date, ?string $end_date = null, int $limit = 12 ): array;

	/**
	 * array( 'total' => int, 'rows' => rows ): rows as recent_workouts() plus start_time and
	 * workout_types; newest first.
	 */
	public function search_backblasts( ?string $ao = null, ?string $month = null, ?string $q = null, ?string $workout_type = null, int $limit = 24, int $offset = 0 ): array;

	/** One workout as search_backblasts() rows, with the full backblast plus qs, coqs and pax; or null. */
	public function backblast( int $event_instance_id ): ?array;

	/** array( 'aos' => [name, n], 'months' => [month, n], 'types' => [name, n] ). */
	public function backblast_filters(): array;

	/** Rows: user_id, f3_name, total_posts, qs, coqs, aos_visited, first_post, last_post, active_months. */
	public function all_pax_stats(): array;

	/** Rows: user_id, ao_name, posts, qs, rn — each PAX's top AOs. */
	public function pax_top_aos( int $top_n_per_pax = 5 ): array;

	/** array( user_id => array( 'IYYY-WIW', … ) ), users and weeks ascending. */
	public function pax_weekly_activity(): array;

	/** array( user_id => array( 'YYYY-MM', … ) ). */
	public function pax_monthly_activity(): array;

	/** Weeks each PAX Q'd. */
	public function pax_q_weekly_activity(): array;

	/** Weeks each PAX posted twice or more. */
	public function pax_double_weekly_activity(): array;

	/** Weeks each PAX posted on day-of-week $dow (0 = Sunday). */
	public function pax_dow_weekly_activity( int $dow ): array;

	/** Weeks each PAX posted at their home AO. */
	public function pax_home_ao_weekly_activity(): array;
}

/** GloomSchedule (the Q schedule), as the stats repo's gloomschedule/client.py. */
interface FStats_Schedule {
	/** array( 'aos' => [ name, slack_channel_id, shutdown_date, site_qs: [ f3_name, … ] ] ). */
	public function get_ao_details( bool $active_only = true ): array;

	/** array( 'scheduled_events' => [ ao_name, event_type, start_time, qs: [ f3_name, status ] ] ) for one date. */
	public function get_scheduled_qs( string $date ): array;
}
