<?php
/**
 * Find a workout: the map page (the page with slug "locations", "Find a Workout" on the live site).
 * Every AO from GloomSchedule, grouped by where it meets, on a map with a list beside it; filter by
 * day and by 1st / 2nd / 3rd F, sort by distance from you. Data from Fort Stats (fort_stats_map()),
 * refreshed hourly in the background. The list is plain HTML; assets/locations.js adds the map.
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

/** The AO map (fort_stats_map()), or null without Fort Stats or GloomSchedule. */
function fort_map() {
	if ( ! function_exists( 'fort_stats_map' ) ) {
		return null;
	}
	$data = fort_stats_map();
	return empty( $data['configured'] ) ? null : $data;
}

/** The map page's URL, or '' when the site has no "locations" page. */
function fort_locations_url() {
	return fort_page_url( 'locations', '' );
}

/** Day numbers (1 = Monday) → "Mon", "Mon & Wed", "Mon, Wed & Fri". */
function fort_loc_days( array $days ) {
	$names = array( 1 => __( 'Mon', 'fort' ), 2 => __( 'Tue', 'fort' ), 3 => __( 'Wed', 'fort' ), 4 => __( 'Thu', 'fort' ), 5 => __( 'Fri', 'fort' ), 6 => __( 'Sat', 'fort' ), 7 => __( 'Sun', 'fort' ) );
	$list  = array_map( fn( $d ) => $names[ $d ] ?? '', $days );
	$last  = array_pop( $list );
	return $list ? implode( ', ', $list ) . ' & ' . $last : (string) $last;
}

/** "Today", "Tomorrow" or "Tue, Oct 27" for a Y-m-d date. */
function fort_loc_day_name( $date, $today ) {
	if ( $date === $today ) {
		return __( 'Today', 'fort' );
	}
	if ( gmdate( 'Y-m-d', strtotime( $today . ' +1 day' ) ) === $date ) {
		return __( 'Tomorrow', 'fort' );
	}
	return gmdate( 'D, M j', strtotime( $date . ' 00:00:00 UTC' ) );
}

/** Directions to a spot, in whatever maps app the phone uses for Google Maps links. */
function fort_loc_directions_url( $lat, $lng ) {
	return 'https://www.google.com/maps/dir/?api=1&destination=' . rawurlencode( $lat . ',' . $lng );
}

/** One AO line in the list ($venue: say where it meets, for AOs not grouped under a place). */
function fort_render_loc_ao( array $a, $today, $venue = false ) {
	$labels = array( '2nd' => __( '2nd F', 'fort' ), '3rd' => __( '3rd F', 'fort' ) );
	$meta   = $venue && $a['venue'] ? array( $a['venue'] ) : array();
	if ( $a['types'] ) {
		$meta[] = implode( ', ', $a['types'] );
	}
	if ( null !== $a['avg_pax'] && $a['avg_pax'] >= 1 ) {
		/* translators: %d: average number of men at a workout this year */
		$meta[] = sprintf( __( 'about %d PAX', 'fort' ), (int) round( $a['avg_pax'] ) );
	}
	if ( $a['site_qs'] ) {
		/* translators: %s: site Q name(s) */
		$meta[] = sprintf( __( 'Site Q %s', 'fort' ), implode( ' & ', $a['site_qs'] ) );
	}
	$url = $a['stats_id'] && function_exists( 'fort_stats_url' ) ? fort_stats_url( 'ao', $a['stats_id'] ) : '';
	?>
	<li class="fort-loc__ao<?php echo '1st' === $a['kind'] ? '' : ' is-other'; ?>" data-days="<?php echo esc_attr( implode( ' ', $a['days'] ) ); ?>" data-kind="<?php echo esc_attr( $a['kind'] ); ?>">
		<span class="fort-loc__when">
			<span class="fort-loc__days"><?php echo esc_html( fort_loc_days( $a['days'] ) ); ?></span>
			<span class="fort-loc__time"><?php echo esc_html( $a['time'] ); ?></span>
		</span>
		<span class="fort-loc__what">
			<span class="fort-loc__name">
				<?php echo $url ? '<a href="' . esc_url( $url ) . '">' . esc_html( $a['name'] ) . '</a>' : esc_html( $a['name'] ); ?>
				<?php if ( isset( $labels[ $a['kind'] ] ) ) : ?><span class="fort-tag fort-tag--muted"><?php echo esc_html( $labels[ $a['kind'] ] ); ?></span><?php endif; ?>
				<?php if ( $a['starts'] ) : ?><span class="fort-tag fort-loc__new"><?php echo esc_html( sprintf( /* translators: %s: date */ __( 'Starts %s', 'fort' ), gmdate( 'M j', strtotime( $a['starts'] . ' 00:00:00 UTC' ) ) ) ); ?></span><?php endif; ?>
			</span>
			<?php if ( $meta ) : ?><span class="fort-loc__meta"><?php echo esc_html( implode( ' · ', $meta ) ); ?></span><?php endif; ?>
			<?php if ( $a['next'] ) : ?>
				<span class="fort-loc__next"><?php echo esc_html( sprintf( /* translators: 1: day, 2: Q name(s) */ __( 'Next: %1$s · Q %2$s', 'fort' ), fort_loc_day_name( $a['next']['date'], $today ), implode( ' & ', $a['next']['qs'] ) ) ); ?></span>
			<?php endif; ?>
		</span>
	</li>
	<?php
}

/** The data assets/locations.js draws the pins from. */
function fort_loc_map_json( array $map ) {
	$sites = array();
	foreach ( $map['sites'] as $s ) {
		$sites[] = array(
			'id'    => $s['id'],
			'lat'   => $s['lat'],
			'lng'   => $s['lng'],
			'venue' => $s['venue'] ?? $s['aos'][0]['name'],
			'aos'   => array_map( fn( $a ) => array( 'name' => $a['name'], 'days' => $a['days'], 'time' => $a['time'], 'kind' => $a['kind'] ), $s['aos'] ),
		);
	}
	return wp_json_encode( array( 'center' => $map['center'], 'sites' => $sites ) );
}

add_action(
	'wp_enqueue_scripts',
	function () {
		if ( ! is_page( 'locations' ) ) {
			return;
		}
		$dir = get_template_directory_uri() . '/assets';
		wp_enqueue_style( 'leaflet', $dir . '/vendor/leaflet/leaflet.css', array(), '1.9.4' );
		wp_enqueue_script( 'leaflet', $dir . '/vendor/leaflet/leaflet.js', array(), '1.9.4', true );
		wp_enqueue_script( 'fort-locations', $dir . '/locations.js', array( 'leaflet' ), FORT_THEME_VERSION, true );
	}
);

// The live site's old Leaflet page (slug "live-map") goes to this one.
add_action(
	'template_redirect',
	function () {
		if ( is_page( 'live-map' ) && fort_locations_url() ) {
			wp_safe_redirect( fort_locations_url(), 301 );
			exit;
		}
	}
);
