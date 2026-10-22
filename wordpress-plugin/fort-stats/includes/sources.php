<?php
/**
 * The two other inputs, both over HTTPS: GloomSchedule (the Q schedule; port of the stats repo's
 * gloomschedule/client.py) and the FNG sign-up sheet (a published Google Sheet CSV).
 *
 * Settings: FORT_GS_API_ENDPOINT and FORT_GS_API_KEY in wp-config.php; the sheet's URL and the
 * FNG challenge's dates under Settings → Fort Stats (or FORT_FNG_SHEET_URL / FORT_FNG_START /
 * FORT_FNG_END).
 *
 * @package FortStats
 */

defined( 'ABSPATH' ) || exit;

class FStats_GloomSchedule implements FStats_Schedule {
	private $base;
	private $key;

	public function __construct( $base, $key ) {
		$this->base = rtrim( $base, '/' );
		$this->key  = $key;
	}

	/** The client from wp-config.php, or null when GloomSchedule isn't set up. */
	public static function from_config() {
		if ( ! defined( 'FORT_GS_API_ENDPOINT' ) || ! FORT_GS_API_ENDPOINT || ! defined( 'FORT_GS_API_KEY' ) || ! FORT_GS_API_KEY ) {
			return null;
		}
		return new self( FORT_GS_API_ENDPOINT, FORT_GS_API_KEY );
	}

	/** An API token, reused (in a transient) until a minute before it expires. */
	private function token() {
		$cached = get_transient( 'fstats_gs_token' );
		if ( $cached ) {
			return $cached;
		}
		$res = wp_remote_post(
			$this->base . '/api-request-token',
			array( 'timeout' => 30, 'headers' => array( 'Content-Type' => 'application/json' ), 'body' => wp_json_encode( array( 'api_key' => $this->key ) ) )
		);
		$data = is_wp_error( $res ) ? null : json_decode( wp_remote_retrieve_body( $res ), true );
		if ( empty( $data['token'] ) ) {
			throw new FStats_Unavailable( 'GloomSchedule token request failed: ' . ( is_wp_error( $res ) ? $res->get_error_message() : wp_remote_retrieve_response_code( $res ) ) );
		}
		$expires = strtotime( (string) ( $data['expires_at'] ?? '' ) ) ?: time() + 600;
		$ttl     = $expires - time() - 60;
		if ( $ttl > 0 ) {
			set_transient( 'fstats_gs_token', $data['token'], $ttl );
		}
		return $data['token'];
	}

	private function get( $path, array $params ) {
		$url = add_query_arg( array_map( 'rawurlencode', array( 'token' => $this->token() ) + $params ), $this->base . '/' . $path );
		$res = wp_remote_get( $url, array( 'timeout' => 30, 'headers' => array( 'Accept' => 'application/json' ) ) );
		if ( is_wp_error( $res ) || 200 !== (int) wp_remote_retrieve_response_code( $res ) ) {
			throw new FStats_Unavailable( "GloomSchedule $path failed: " . ( is_wp_error( $res ) ? $res->get_error_message() : wp_remote_retrieve_response_code( $res ) ) );
		}
		return (array) json_decode( wp_remote_retrieve_body( $res ), true );
	}

	public function get_ao_details( bool $active_only = true ): array {
		return $this->get( 'api-get-ao', array( 'activeOnly' => $active_only ? 'true' : 'false' ) );
	}

	/** @var array<string, array> Days fetched ahead by prefetch(). */
	private $days = array();

	public function get_scheduled_qs( string $date ): array {
		return $this->days[ $date ] ?? $this->get( 'api-get-scheduled-qs', array( 'date' => $date ) );
	}

	/** Fetches several days' schedules at once (in parallel), for get_scheduled_qs(). */
	public function prefetch( array $dates ) {
		$token    = $this->token();
		$requests = array();
		foreach ( $dates as $d ) {
			$requests[ $d ] = array(
				'url'     => add_query_arg( array( 'token' => rawurlencode( $token ), 'date' => rawurlencode( $d ) ), $this->base . '/api-get-scheduled-qs' ),
				'headers' => array( 'Accept' => 'application/json' ),
			);
		}
		$responses = WpOrg\Requests\Requests::request_multiple( $requests, array( 'timeout' => 30, 'connect_timeout' => 10, 'verify' => ABSPATH . WPINC . '/certificates/ca-bundle.crt' ) );
		foreach ( $responses as $d => $res ) {
			if ( $res instanceof WpOrg\Requests\Exception || 200 !== (int) $res->status_code ) {
				throw new FStats_Unavailable( 'GloomSchedule api-get-scheduled-qs failed for ' . $d );
			}
			$this->days[ $d ] = (array) json_decode( (string) $res->body, true );
		}
	}
}

/** Settings → Fort Stats, falling back to wp-config.php constants. */
function fstats_setting( $name ) {
	$value = get_option( 'fstats_' . $name, '' );
	if ( '' === $value ) {
		$const = 'FORT_' . strtoupper( $name );
		$value = defined( $const ) ? constant( $const ) : '';
	}
	return (string) $value;
}

/** The FNG sheet's records (fstats_parse_fng_csv()), or array() when no sheet is set. */
function fstats_fng_records() {
	$url = fstats_setting( 'fng_sheet_url' );
	if ( '' === $url ) {
		throw new FStats_Unavailable( 'No FNG sheet URL set (Settings → Fort Stats).' );
	}
	$res = wp_remote_get( $url, array( 'timeout' => 15 ) );
	if ( is_wp_error( $res ) || 200 !== (int) wp_remote_retrieve_response_code( $res ) ) {
		throw new FStats_Unavailable( 'FNG sheet: ' . ( is_wp_error( $res ) ? $res->get_error_message() : wp_remote_retrieve_response_code( $res ) ) );
	}
	return fstats_parse_fng_csv( wp_remote_retrieve_body( $res ) );
}
