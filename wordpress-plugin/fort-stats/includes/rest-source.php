<?php
/**
 * The stats data over HTTPS: FStats_Source on Supabase's REST API (PostgREST).
 *
 * Each method calls its `stats_api_*` function (the stats repo's analytics-sync/stats-api.sql)
 * with POST {FORT_STATS_REST_URL}/rpc/<name> and the anon key. A payload makes 10-25 such calls,
 * so fstats_build() first runs the builder against a recorder to learn which calls it makes,
 * fetches them all at once (in parallel), then runs it for real from those answers.
 *
 * @package FortStats
 */

defined( 'ABSPATH' ) || exit;

/** Supabase couldn't be reached, or answered with an error. */
class FStats_Unavailable extends RuntimeException {}

/** True when the REST URL and anon key are set in wp-config.php. */
function fstats_configured() {
	return defined( 'FORT_STATS_REST_URL' ) && FORT_STATS_REST_URL && defined( 'FORT_STATS_ANON_KEY' ) && FORT_STATS_ANON_KEY;
}

/**
 * Calls several stats_api_* functions at once. $calls: array( key => array( fn, args ) ).
 * Returns array( key => decoded JSON ). Throws FStats_Unavailable if any call fails.
 */
function fstats_rpc_many( array $calls ) {
	if ( ! $calls ) {
		return array();
	}
	if ( ! fstats_configured() ) {
		throw new FStats_Unavailable( 'Fort Stats is not configured (FORT_STATS_REST_URL / FORT_STATS_ANON_KEY).' );
	}
	$base     = rtrim( FORT_STATS_REST_URL, '/' );
	$headers  = array(
		'apikey'       => FORT_STATS_ANON_KEY,
		'Content-Type' => 'application/json',
		'Accept'       => 'application/json',
	);
	// A legacy anon key (a JWT) also goes in Authorization; the newer publishable keys
	// (sb_publishable_…) aren't JWTs and go in apikey only.
	if ( str_starts_with( FORT_STATS_ANON_KEY, 'eyJ' ) ) {
		$headers['Authorization'] = 'Bearer ' . FORT_STATS_ANON_KEY;
	}
	$requests = array();
	foreach ( $calls as $k => list( $fn, $args ) ) {
		$requests[ $k ] = array(
			'url'     => $base . '/rpc/' . rawurlencode( $fn ),
			'type'    => 'POST',
			'headers' => $headers,
			'data'    => wp_json_encode( (object) $args ),
		);
	}
	$responses = WpOrg\Requests\Requests::request_multiple(
		$requests,
		array( 'timeout' => 15, 'connect_timeout' => 10, 'verify' => ABSPATH . WPINC . '/certificates/ca-bundle.crt' )
	);
	$out = array();
	foreach ( $responses as $k => $res ) {
		if ( $res instanceof WpOrg\Requests\Exception ) {
			throw new FStats_Unavailable( $calls[ $k ][0] . ': ' . $res->getMessage() );
		}
		if ( 200 !== (int) $res->status_code ) {
			throw new FStats_Unavailable( $calls[ $k ][0] . ': HTTP ' . $res->status_code . ' ' . substr( (string) $res->body, 0, 200 ) );
		}
		$data = json_decode( (string) $res->body, true );
		if ( null === $data && 'null' !== trim( (string) $res->body ) ) {
			throw new FStats_Unavailable( $calls[ $k ][0] . ': not JSON' );
		}
		$out[ $k ] = $data;
	}
	return $out;
}

/** The FStats_Source methods → their RPC name and arguments. */
function fstats_rpc_for( $method, array $a ) {
	$d = fn( $i ) => $a[ $i ] ?? null;
	switch ( $method ) {
		case 'available_months':
			return array( 'stats_api_available_months', array( 'p_limit' => $a[0] ?? 24 ) );
		case 'summary':
		case 'ao_breakdown':
		case 'monthly_trend':
		case 'weekly_posts':
		case 'ao_monthly_trend':
			return array( 'stats_api_' . $method, array( 'p_start' => $d( 0 ), 'p_end' => $d( 1 ) ) );
		case 'attendance_leaderboard':
			return array( 'stats_api_attendance_leaderboard', array( 'p_start' => $d( 0 ), 'p_end' => $d( 1 ), 'p_top_n' => $a[2] ?? 25 ) );
		case 'ao_top_attendees':
			return array( 'stats_api_ao_top_attendees', array( 'p_top_n_per_ao' => $a[0] ?? 15, 'p_start' => $d( 1 ), 'p_end' => $d( 2 ) ) );
		case 'ao_most_posts_no_q':
			return array( 'stats_api_ao_most_posts_no_q', array( 'p_start' => $a[0] ) );
		case 'recent_workouts':
			return array( 'stats_api_recent_workouts', array( 'p_start' => $a[0], 'p_end' => $d( 1 ), 'p_limit' => $a[2] ?? 12 ) );
		case 'search_backblasts':
			return array( 'stats_api_search_backblasts', array( 'p_ao' => $d( 0 ), 'p_month' => $d( 1 ), 'p_q' => $d( 2 ), 'p_type' => $d( 3 ), 'p_limit' => $a[4] ?? 24, 'p_offset' => $a[5] ?? 0 ) );
		case 'backblast':
			return array( 'stats_api_backblast', array( 'p_event_instance_id' => (int) $a[0] ) );
		case 'pax_top_aos':
			return array( 'stats_api_pax_top_aos', array( 'p_top_n_per_pax' => $a[0] ?? 5 ) );
		case 'pax_dow_weekly_activity':
			return array( 'stats_api_pax_dow_weekly_activity', array( 'p_dow' => (int) $a[0] ) );
		default: // No arguments.
			return array( 'stats_api_' . $method, array() );
	}
}

/**
 * Records the calls a builder makes (answering each with an empty result), or answers them from
 * already-fetched results.
 */
class FStats_Rest_Source implements FStats_Source {
	/** @var array<string, array{0: string, 1: array}> */
	public $wanted = array();
	/** @var array<string, mixed>|null */
	private $answers;

	public function __construct( ?array $answers = null ) {
		$this->answers = $answers;
	}

	private function call( $method, array $args, $empty ) {
		$rpc = fstats_rpc_for( $method, $args );
		$key = md5( wp_json_encode( $rpc ) );
		if ( null === $this->answers ) {
			$this->wanted[ $key ] = $rpc;
			return $empty;
		}
		if ( ! array_key_exists( $key, $this->answers ) ) {
			$this->answers += fstats_rpc_many( array( $key => $rpc ) ); // A call the recording pass didn't see.
		}
		return $this->answers[ $key ];
	}

	public function region_name(): string {
		return (string) ( $this->call( __FUNCTION__, func_get_args(), 'F3' ) ?? 'F3' );
	}
	public function sync_status(): array {
		return (array) $this->call( __FUNCTION__, func_get_args(), array() );
	}
	public function available_months( int $limit = 24 ): array {
		return (array) $this->call( __FUNCTION__, func_get_args(), array() );
	}
	public function summary( ?string $start_date = null, ?string $end_date = null ): array {
		return (array) $this->call( __FUNCTION__, func_get_args(), array( 'workouts' => 0, 'pax_posts' => 0, 'unique_pax' => 0, 'unique_qs' => 0 ) );
	}
	public function active_ao_names(): array {
		return (array) $this->call( __FUNCTION__, func_get_args(), array() );
	}
	public function attendance_leaderboard( ?string $start_date = null, ?string $end_date = null, int $top_n = 25 ): array {
		return (array) $this->call( __FUNCTION__, func_get_args(), array() );
	}
	public function ao_breakdown( ?string $start_date = null, ?string $end_date = null ): array {
		return (array) $this->call( __FUNCTION__, func_get_args(), array() );
	}
	public function ao_top_attendees( int $top_n_per_ao = 15, ?string $start_date = null, ?string $end_date = null ): array {
		return (array) $this->call( __FUNCTION__, func_get_args(), array() );
	}
	public function ao_most_posts_no_q( string $start_date ): array {
		return (array) $this->call( __FUNCTION__, func_get_args(), array() );
	}
	public function monthly_trend( ?string $start_date = null, ?string $end_date = null ): array {
		return (array) $this->call( __FUNCTION__, func_get_args(), array() );
	}
	public function weekly_posts( ?string $start_date = null, ?string $end_date = null ): array {
		return (array) $this->call( __FUNCTION__, func_get_args(), array() );
	}
	public function ao_monthly_trend( ?string $start_date = null, ?string $end_date = null ): array {
		return (array) $this->call( __FUNCTION__, func_get_args(), array() );
	}
	public function recent_workouts( string $start_date, ?string $end_date = null, int $limit = 12 ): array {
		return (array) $this->call( __FUNCTION__, func_get_args(), array() );
	}
	public function search_backblasts( ?string $ao = null, ?string $month = null, ?string $q = null, ?string $workout_type = null, int $limit = 24, int $offset = 0 ): array {
		return (array) $this->call( __FUNCTION__, func_get_args(), array( 'total' => 0, 'rows' => array() ) );
	}
	public function backblast( int $event_instance_id ): ?array {
		return $this->call( __FUNCTION__, func_get_args(), null );
	}
	public function backblast_filters(): array {
		return (array) $this->call( __FUNCTION__, func_get_args(), array( 'aos' => array(), 'months' => array(), 'types' => array() ) );
	}
	public function all_pax_stats(): array {
		return (array) $this->call( __FUNCTION__, func_get_args(), array() );
	}
	public function pax_top_aos( int $top_n_per_pax = 5 ): array {
		return (array) $this->call( __FUNCTION__, func_get_args(), array() );
	}
	public function pax_weekly_activity(): array {
		return (array) $this->call( __FUNCTION__, func_get_args(), array() );
	}
	public function pax_monthly_activity(): array {
		return (array) $this->call( __FUNCTION__, func_get_args(), array() );
	}
	public function pax_q_weekly_activity(): array {
		return (array) $this->call( __FUNCTION__, func_get_args(), array() );
	}
	public function pax_double_weekly_activity(): array {
		return (array) $this->call( __FUNCTION__, func_get_args(), array() );
	}
	public function pax_dow_weekly_activity( int $dow ): array {
		return (array) $this->call( __FUNCTION__, func_get_args(), array() );
	}
	public function pax_home_ao_weekly_activity(): array {
		return (array) $this->call( __FUNCTION__, func_get_args(), array() );
	}
}

/**
 * Runs a payload builder against Supabase: a recording pass, one parallel fetch, then the real
 * pass. $builder receives an FStats_Source. Throws FStats_Unavailable.
 */
function fstats_build( callable $builder ) {
	$recorder = new FStats_Rest_Source();
	$builder( $recorder );
	return $builder( new FStats_Rest_Source( fstats_rpc_many( $recorder->wanted ) ) );
}
