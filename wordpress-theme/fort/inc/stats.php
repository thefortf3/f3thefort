<?php
/**
 * The stats pages' pieces (fort-stats.php): one renderer per view, plus shared bits (tabs,
 * filters, tables, bars, column charts). The data comes from the Fort Stats plugin
 * (fort_stats_core() and friends, fstats_* helpers); everything is plain server-rendered HTML in
 * the theme's style, with filters as ordinary links and GET forms.
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

// ── Shared ────────────────────────────────────────────────────────────────────────────────

/** A query argument, limited to $allowed (when given), else $default. */
function fort_st_arg( $name, $allowed = null, $default = '' ) {
	$v = isset( $_GET[ $name ] ) ? sanitize_text_field( wp_unslash( $_GET[ $name ] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
	if ( null === $allowed ) {
		return '' === $v ? $default : $v;
	}
	return in_array( $v, (array) $allowed, true ) ? $v : $default;
}

function fort_st_n( $n ) {
	return number_format_i18n( (float) $n, is_float( $n ) && floor( $n ) !== $n ? 1 : 0 );
}

/** array( ao name => ao_id ) for linking AO names to their pages. */
function fort_st_ao_ids( $core ) {
	static $map = null;
	if ( null === $map ) {
		$map = array();
		foreach ( $core['ao_data']['all_time'] ?? array() as $a ) {
			$map[ $a['ao_name'] ] = (int) $a['ao_id'];
		}
	}
	return $map;
}

function fort_st_pax_link( $id, $name ) {
	return '<a class="fort-st__name" href="' . esc_url( fort_stats_url( 'pax', $id ) ) . '">' . esc_html( $name ) . '</a>';
}

function fort_st_ao_link( $core, $name ) {
	$id = fort_st_ao_ids( $core )[ $name ] ?? 0;
	return $id ? '<a href="' . esc_url( fort_stats_url( 'ao', $id ) ) . '">' . esc_html( $name ) . '</a>' : esc_html( (string) $name );
}

/** A horizontal bar, $pct (0-100) filled. */
function fort_st_bar( $pct, $tone = '' ) {
	return '<span class="fort-st-bar' . ( $tone ? ' fort-st-bar--' . esc_attr( $tone ) : '' ) . '" aria-hidden="true"><span style="width:' . esc_attr( (string) $pct ) . '%"></span></span>';
}

/** A row of text options (links), the current one underlined: $items = array( value => label ). */
function fort_st_chips( array $items, $current, callable $url, $label = '' ) {
	echo '<nav class="fort-st-seg"' . ( $label ? ' aria-label="' . esc_attr( $label ) . '"' : '' ) . '>';
	foreach ( $items as $value => $text ) {
		$is = (string) $value === (string) $current;
		echo '<a class="fort-st-seg__opt' . ( $is ? ' is-current' : '' ) . '" href="' . esc_url( $url( $value ) ) . '"' . ( $is ? ' aria-current="true"' : '' ) . '>' . esc_html( $text ) . '</a>';
	}
	echo '</nav>';
}

/**
 * A column chart: $cols = list of array( label, value, title? ). Bars are scaled to the largest
 * value; $show_values prints each value above its bar.
 */
function fort_st_cols( array $cols, $show_values = true, $tone = '', $mark_last = true ) {
	$max = max( 1, ...array_map( fn( $c ) => (float) $c[1], $cols ?: array( array( '', 0 ) ) ) );
	$aria = implode( ', ', array_map( fn( $c ) => ( $c[2] ?? ( $c[0] . ': ' . fort_st_n( $c[1] ) ) ), $cols ) ) . ( $mark_last && $cols ? ' ' . __( '(the last one so far)', 'fort' ) : '' );
	echo '<div class="fort-st-cols' . ( $tone ? ' fort-st-cols--' . esc_attr( $tone ) : '' ) . ( $show_values ? '' : ' fort-st-cols--compact' ) . '" role="img" aria-label="' . esc_attr( $aria ) . '">';
	$last = count( $cols ) - 1;
	foreach ( $cols as $i => $c ) {
		echo '<div class="fort-st-col' . ( $mark_last && $i === $last ? ' is-now' : '' ) . '" title="' . esc_attr( $c[2] ?? ( $c[0] . ': ' . fort_st_n( $c[1] ) ) ) . '">';
		echo '<span class="fort-st-col__v">' . ( $show_values ? esc_html( fort_st_n( $c[1] ) ) : '' ) . '</span>';
		echo '<span class="fort-st-col__bar" style="height:' . esc_attr( (string) fstats_pct( $c[1], $max ) ) . '%"></span>';
		echo '<span class="fort-st-col__l">' . esc_html( $c[0] ) . '</span></div>';
	}
	echo '</div>';
}

/** Big numbers: list of array( number, label, tone? ). */
function fort_st_numbers( array $items ) {
	echo '<div class="fort-st-numbers">';
	foreach ( $items as $i ) {
		echo '<div><span class="fort-stat__num' . ( ! empty( $i[2] ) ? ' fort-' . esc_attr( $i[2] ) : '' ) . '">' . esc_html( is_numeric( $i[0] ) ? fort_st_n( $i[0] ) : (string) $i[0] ) . '</span><span class="fort-label">' . esc_html( $i[1] ) . '</span></div>';
	}
	echo '</div>';
}

/** A ranked list with bars: rows of array( name_html, value, extra? ); $unit after the value. */
function fort_st_ranked( array $rows, $unit = '', $tone = '' ) {
	if ( ! $rows ) {
		echo '<p class="fort-dim">' . esc_html__( 'Nothing here yet.', 'fort' ) . '</p>';
		return;
	}
	$max = max( 1, ...array_map( fn( $r ) => (float) $r[1], $rows ) );
	echo '<ol class="fort-st-ranked">';
	foreach ( $rows as $i => $r ) {
		echo '<li><span class="fort-st-ranked__n">' . (int) ( $i + 1 ) . '</span><span class="fort-st-ranked__name">' . $r[0] . '</span>' // phpcs:ignore WordPress.Security.EscapeOutput -- built from escaped parts.
			. fort_st_bar( fstats_pct( $r[1], $max ), $tone )
			. '<span class="fort-st-ranked__v">' . esc_html( fort_st_n( $r[1] ) ) . ( $unit ? ' <small>' . esc_html( $unit ) . '</small>' : '' ) . '</span>'
			. ( isset( $r[2] ) ? '<span class="fort-st-ranked__x">' . esc_html( $r[2] ) . '</span>' : '' ) . '</li>';
	}
	echo '</ol>';
}

/** The page's kicker, title, dek, renderer and back link (and 'missing' for unknown PAX / AOs). */
function fort_st_page( $view, $core ) {
	$base = array( 'kicker' => __( 'By the numbers', 'fort' ), 'title' => fort_stats_title(), 'dek' => '', 'back' => null );
	switch ( $view ) {
		case 'pax':
			$d = $core ? fstats_pax_detail( $core, fort_stats_id() ) : null;
			return array_merge( $base, array( 'kicker' => __( 'Stats · PAX', 'fort' ), 'render' => fn( $c ) => fort_st_pax( $c, $d ), 'back' => array( fort_stats_url(), __( 'Leaderboard', 'fort' ) ), 'missing' => $core && ! $d ),
				$d ? array( 'dek' => sprintf( /* translators: 1: date, 2: date */ __( 'Posting since %1$s · last post %2$s', 'fort' ), fort_st_date( $d['first_post'] ), fort_st_date( $d['last_post'] ) ) ) : array() );
		case 'ao':
			$d = $core ? fstats_ao_detail( $core, fort_stats_id(), $core['today'] ) : null;
			return array_merge( $base, array( 'kicker' => __( 'Stats · AO', 'fort' ), 'render' => fn( $c ) => fort_st_ao( $c, $d ), 'back' => array( fort_stats_url( 'aos' ), __( 'All AOs', 'fort' ) ), 'missing' => $core && ! $d ) );
		case 'aos':
			return array_merge( $base, array( 'dek' => __( 'Every AO: workouts, posts and how many men show up.', 'fort' ), 'render' => 'fort_st_aos' ) );
		case 'trends':
			return array_merge( $base, array( 'dek' => __( 'Posts, men and FNGs over the last year.', 'fort' ), 'render' => 'fort_st_trends' ) );
		case 'streaks':
			return array_merge( $base, array( 'dek' => __( 'Who keeps showing up, week after week.', 'fort' ), 'render' => 'fort_st_streaks' ) );
		case 'fngs':
			return array_merge( $base, array( 'dek' => __( 'New guys, who brought them, and where they posted.', 'fort' ), 'render' => 'fort_st_fngs' ) );
		case 'fng-challenge':
			$ch = fort_stats_fng_challenge();
			return array_merge(
				$base,
				array(
					'kicker' => $ch ? sprintf( /* translators: %s: month */ __( 'FNG challenge · %s', 'fort' ), $ch['month_label'] ) : __( 'FNG challenge', 'fort' ),
					'title'  => __( 'Which AO brings the most FNGs?', 'fort' ),
					'dek'    => $ch ? sprintf( /* translators: 1: date, 2: date */ __( '%1$s to %2$s. Every AO starts at zero.', 'fort' ), fort_st_date( $ch['start_date'] ), fort_st_date( $ch['end_date'] ) ) : '',
					'render' => fn( $c ) => fort_st_fng_challenge( $ch ),
				)
			);
		default:
			return array_merge( $base, array( 'dek' => __( 'Every post, Q and streak in The Fort, from the backblasts.', 'fort' ), 'render' => 'fort_st_leaderboard' ) );
	}
}

function fort_st_date( $iso ) {
	$t = strtotime( (string) $iso . ' 00:00:00 UTC' );
	return $t ? gmdate( 'M j, Y', $t ) : '—';
}

/** The tabs between the views, and when the data last synced. */
function fort_st_tabs( $view, $core ) {
	$tabs    = array(
		'leaderboard'   => __( 'Leaderboard', 'fort' ),
		'aos'           => __( 'AOs', 'fort' ),
		'trends'        => __( 'Trends', 'fort' ),
		'streaks'       => __( 'Streaks', 'fort' ),
		'fngs'          => __( 'FNGs', 'fort' ),
		'fng-challenge' => __( 'FNG challenge', 'fort' ),
	);
	$current = array( 'pax' => 'leaderboard', 'ao' => 'aos' )[ $view ] ?? $view;
	echo '<nav class="fort-st-tabs" aria-label="' . esc_attr__( 'Stats', 'fort' ) . '"><div class="fort-st-tabs__list">';
	foreach ( $tabs as $id => $label ) {
		$is = $id === $current;
		echo '<a class="fort-st-tab' . ( $is ? ' is-current' : '' ) . '" href="' . esc_url( fort_stats_url( $id ) ) . '"' . ( $is && $view === $id ? ' aria-current="page"' : '' ) . '>' . esc_html( $label ) . '</a>';
	}
	echo '</div>';
	if ( ! empty( $core['synced_at'] ) ) {
		/* translators: %s: date */
		echo '<span class="fort-st-tabs__synced">' . esc_html( sprintf( __( 'Updated %s', 'fort' ), fort_st_date( substr( $core['synced_at'], 0, 10 ) ) ) ) . '</span>';
	}
	echo '</nav>';
}

/** The search box and month list, matching heights, no button (Enter / choosing submits). */
function fort_st_find_form( $view, $core, array $hidden, $month, $q = null ) {
	?>
	<form class="fort-st-find" method="get" action="<?php echo esc_url( fort_stats_url( $view ) ); ?>" role="search">
		<?php foreach ( array_filter( $hidden ) as $k => $v ) : ?>
			<input type="hidden" name="<?php echo esc_attr( $k ); ?>" value="<?php echo esc_attr( $v ); ?>">
		<?php endforeach; ?>
		<?php if ( null !== $q ) : ?>
			<label class="screen-reader-text" for="fort-st-q"><?php esc_html_e( 'Find a PAX', 'fort' ); ?></label>
			<input id="fort-st-q" type="search" name="q" value="<?php echo esc_attr( $q ); ?>" placeholder="<?php esc_attr_e( 'Find a PAX', 'fort' ); ?>">
		<?php endif; ?>
		<label class="screen-reader-text" for="fort-st-month"><?php esc_html_e( 'One month', 'fort' ); ?></label>
		<select id="fort-st-month" name="month" onchange="this.form.submit()">
			<option value=""><?php esc_html_e( 'Any month', 'fort' ); ?></option>
			<?php foreach ( $core['available_months'] ?? array() as $m ) : ?>
				<option value="<?php echo esc_attr( $m ); ?>"<?php selected( $m, $month ); ?>><?php echo esc_html( fstats_month_label( $m, true ) ); ?></option>
			<?php endforeach; ?>
		</select>
		<noscript><button class="fort-btn" type="submit"><?php esc_html_e( 'Show', 'fort' ); ?></button></noscript>
	</form>
	<?php
}

// ── Leaderboard ───────────────────────────────────────────────────────────────────────────

function fort_st_leaderboard( $core ) {
	$range = fort_st_arg( 'range', array_keys( FSTATS_RANGES ), 'ytd' );
	$month = fort_st_arg( 'month', $core['available_months'] ?? array(), '' );
	$sort  = fort_st_arg( 'sort', array( 'posts', 'qs' ), 'posts' );
	$q     = mb_substr( fort_st_arg( 'q' ), 0, 60 );
	$pg    = max( 1, (int) fort_st_arg( 'pg', null, '1' ) );
	$all   = fstats_rank_rows( $month ? ( fort_stats_month( $month )['leaderboard'] ?? array() ) : ( $core['leaderboards'][ $range ] ?? array() ), $sort );
	$rows  = fstats_search_rows( $all, $q );
	$home  = fstats_home_aos( $core['pax_top_aos'] ?? array() );
	$key   = 'qs' === $sort ? 'qs' : 'total_posts';
	$top   = max( 1, (int) ( $all[0][ $key ] ?? 1 ) );
	// The top three get the podium on the first page of an unsearched board; the table starts at 4.
	$podium = ( '' === $q && 1 === $pg ) ? array_slice( $rows, 0, 3 ) : array();
	$rest   = '' === $q ? array_slice( $rows, 3 ) : $rows;
	$per    = 50;
	$pages  = max( 1, (int) ceil( count( $rest ) / $per ) );
	$pg     = min( $pg, $pages );
	$state  = array( 'range' => $month ? '' : $range, 'month' => $month, 'sort' => 'posts' === $sort ? '' : $sort, 'q' => $q );
	$url    = fn( $over ) => fort_stats_url( 'leaderboard', null, array_merge( $state, $over ) );
	$what   = $month ? fstats_month_label( $month, true ) : FSTATS_RANGES[ $range ];
	?>
	<div class="fort-st-toolbar">
		<?php fort_st_chips( FSTATS_RANGES, $month ? '' : $range, fn( $r ) => $url( array( 'range' => 'ytd' === $r ? '' : $r, 'month' => '', 'pg' => '' ) ), __( 'Time range', 'fort' ) ); ?>
		<?php fort_st_chips( array( 'posts' => __( 'Posts', 'fort' ), 'qs' => __( 'Qs', 'fort' ) ), $sort, fn( $s ) => $url( array( 'sort' => 'posts' === $s ? '' : $s, 'pg' => '' ) ), __( 'Rank by', 'fort' ) ); ?>
		<?php fort_st_find_form( 'leaderboard', $core, array( 'sort' => 'qs' === $sort ? 'qs' : '', 'range' => ! $month && 'ytd' !== $range ? $range : '' ), $month, $q ); ?>
	</div>

	<?php if ( ! $rows ) : ?>
		<p class="fort-dim fort-empty"><?php echo esc_html( '' !== $q ? sprintf( /* translators: %s: name */ __( 'No one matching “%s” posted in this range.', 'fort' ), $q ) : __( 'No posts in this range yet.', 'fort' ) ); ?></p>
		<?php
		return;
	endif;
	?>

	<?php if ( $podium ) : ?>
		<ol class="fort-st-podium" aria-label="<?php esc_attr_e( 'Top three', 'fort' ); ?>">
			<?php foreach ( $podium as $r ) : ?>
				<li class="fort-st-podium__spot fort-st-podium__spot--<?php echo (int) $r['rank']; ?>">
					<span class="fort-st-podium__rank"><?php echo esc_html( sprintf( /* translators: %d: rank */ __( 'No. %d', 'fort' ), $r['rank'] ) ); ?></span>
					<span class="fort-st-podium__num"><?php echo esc_html( fort_st_n( $r[ $key ] ) ); ?><small><?php echo esc_html( 'qs' === $sort ? __( 'Qs', 'fort' ) : __( 'posts', 'fort' ) ); ?></small></span>
					<a class="fort-st-podium__name" href="<?php echo esc_url( fort_stats_url( 'pax', $r['user_id'] ) ); ?>"><?php echo esc_html( $r['f3_name'] ); ?></a>
					<span class="fort-st-podium__meta">
						<?php
						$bits = array( 'qs' === $sort ? sprintf( /* translators: %s: posts */ __( '%s posts', 'fort' ), fort_st_n( $r['total_posts'] ) ) : sprintf( /* translators: %s: Qs */ _n( '%s Q', '%s Qs', (int) $r['qs'], 'fort' ), fort_st_n( $r['qs'] ) ) );
						if ( isset( $home[ $r['user_id'] ] ) ) {
							$bits[] = $home[ $r['user_id'] ];
						}
						echo esc_html( implode( ' · ', $bits ) );
						?>
					</span>
				</li>
			<?php endforeach; ?>
		</ol>
	<?php endif; ?>

	<?php if ( $rest ) : ?>
		<div class="fort-st-table-wrap">
			<table class="fort-st-table fort-st-table--board">
				<caption class="screen-reader-text"><?php echo esc_html( sprintf( /* translators: %s: time range */ __( 'Leaderboard, %s', 'fort' ), $what ) ); ?></caption>
				<thead><tr>
					<th class="fort-st-num" scope="col"><span class="screen-reader-text"><?php esc_html_e( 'Rank', 'fort' ); ?></span></th>
					<th scope="col"><?php esc_html_e( 'PAX', 'fort' ); ?></th>
					<th class="fort-st-num" scope="col"><?php esc_html_e( 'Posts', 'fort' ); ?></th>
					<th class="fort-st-num" scope="col"><?php esc_html_e( 'Qs', 'fort' ); ?></th>
					<th class="fort-st-num fort-st-wide" scope="col"><?php esc_html_e( 'Co-Qs', 'fort' ); ?></th>
					<th class="fort-st-wide" scope="col"><?php esc_html_e( 'Home AO', 'fort' ); ?></th>
				</tr></thead>
				<tbody>
					<?php foreach ( array_slice( $rest, ( $pg - 1 ) * $per, $per ) as $r ) : ?>
						<tr>
							<td class="fort-st-num fort-st-rank"><?php echo (int) $r['rank']; ?></td>
							<td class="fort-st-who">
								<?php echo fort_st_pax_link( $r['user_id'], $r['f3_name'] ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
							</td>
							<td class="fort-st-num<?php echo 'posts' === $sort ? ' is-key' : ''; ?>"><?php echo esc_html( fort_st_n( $r['total_posts'] ) ); ?></td>
							<td class="fort-st-num<?php echo 'qs' === $sort ? ' is-key' : ''; ?>"><?php echo esc_html( fort_st_n( $r['qs'] ) ); ?></td>
							<td class="fort-st-num fort-st-wide"><?php echo esc_html( fort_st_n( $r['coqs'] ) ); ?></td>
							<td class="fort-st-wide fort-st-ao"><?php echo isset( $home[ $r['user_id'] ] ) ? fort_st_ao_link( $core, $home[ $r['user_id'] ] ) : '—'; // phpcs:ignore WordPress.Security.EscapeOutput ?></td>
						</tr>
					<?php endforeach; ?>
				</tbody>
			</table>
		</div>
	<?php endif; ?>
	<p class="fort-st-foot">
		<?php
		/* translators: 1: number of PAX, 2: time range */
		echo esc_html( sprintf( _n( '%1$s PAX posted · %2$s', '%1$s PAX posted · %2$s', count( $all ), 'fort' ), fort_st_n( count( $all ) ), $what ) );
		?>
	</p>
	<?php
	fort_st_pager( $pg, $pages, fn( $p ) => $url( array( 'pg' => $p > 1 ? $p : '' ) ) );
}

function fort_st_pager( $pg, $pages, callable $url ) {
	if ( $pages < 2 ) {
		return;
	}
	echo '<nav class="fort-st-pager" aria-label="' . esc_attr__( 'Pages', 'fort' ) . '">';
	if ( $pg > 1 ) {
		echo '<a class="fort-btn fort-btn--outline" href="' . esc_url( $url( $pg - 1 ) ) . '">' . esc_html__( '← Previous', 'fort' ) . '</a>';
	}
	/* translators: 1: page, 2: pages */
	echo '<span class="fort-mono-dim">' . esc_html( sprintf( __( 'Page %1$d of %2$d', 'fort' ), $pg, $pages ) ) . '</span>';
	if ( $pg < $pages ) {
		echo '<a class="fort-btn fort-btn--outline" href="' . esc_url( $url( $pg + 1 ) ) . '">' . esc_html__( 'Next →', 'fort' ) . '</a>';
	}
	echo '</nav>';
}

// ── AOs ───────────────────────────────────────────────────────────────────────────────────

function fort_st_aos( $core ) {
	$range  = fort_st_arg( 'range', array_keys( FSTATS_RANGES ), 'ytd' );
	$month  = fort_st_arg( 'month', $core['available_months'] ?? array(), '' );
	$cols   = array(
		'workouts'   => __( 'Workouts', 'fort' ),
		'pax_posts'  => __( 'Posts', 'fort' ),
		'unique_pax' => __( 'Men', 'fort' ),
		'avg_pax'    => __( 'Avg', 'fort' ),
	);
	$sort   = fort_st_arg( 'sort', array_keys( $cols ), 'pax_posts' );
	$aos    = fstats_sort_aos( $month ? ( fort_stats_month( $month )['aos'] ?? array() ) : ( $core['ao_data'][ $range ] ?? array() ), $sort );
	$months = fstats_ao_months( $core['ao_monthly_trend'] ?? array() );
	$last12 = fstats_last_months( $core['today'], 12 );
	$max    = max( 1, ...array_map( fn( $a ) => (float) $a[ $sort ], $aos ?: array( array( $sort => 0 ) ) ) );
	$state  = array( 'range' => $month ? '' : $range, 'month' => $month, 'sort' => 'pax_posts' === $sort ? '' : $sort );
	$url    = fn( $over ) => fort_stats_url( 'aos', null, array_merge( $state, $over ) );
	?>
	<div class="fort-st-toolbar">
		<?php fort_st_chips( FSTATS_RANGES, $month ? '' : $range, fn( $r ) => $url( array( 'range' => 'ytd' === $r ? '' : $r, 'month' => '' ) ), __( 'Time range', 'fort' ) ); ?>
		<?php fort_st_find_form( 'aos', $core, array( 'sort' => 'pax_posts' !== $sort ? $sort : '' ), $month ); ?>
	</div>
	<?php if ( ! $aos ) : ?>
		<p class="fort-dim fort-empty"><?php esc_html_e( 'No workouts in this range.', 'fort' ); ?></p>
		<?php
		return;
	endif;
	?>
	<div class="fort-st-table-wrap">
		<table class="fort-st-table fort-st-table--board fort-st-table--aos">
			<thead><tr>
				<th><?php esc_html_e( 'AO', 'fort' ); ?></th>
				<?php foreach ( $cols as $id => $label ) : ?>
					<th class="fort-st-num<?php echo 'avg_pax' === $id || 'workouts' === $id ? ' fort-st-wide' : ''; ?>"><a href="<?php echo esc_url( $url( array( 'sort' => 'pax_posts' === $id ? '' : $id ) ) ); ?>"<?php echo $sort === $id ? ' class="is-sorted" aria-sort="descending"' : ''; ?>><?php echo esc_html( $label . ( $sort === $id ? ' ↓' : '' ) ); ?></a></th>
				<?php endforeach; ?>
				<th class="fort-st-wide"><?php esc_html_e( 'Last 12 months', 'fort' ); ?></th>
			</tr></thead>
			<tbody>
				<?php foreach ( $aos as $a ) : ?>
					<tr>
						<td class="fort-st-who"><a class="fort-st__name" href="<?php echo esc_url( fort_stats_url( 'ao', $a['ao_id'] ) ); ?>"><?php echo esc_html( $a['ao_name'] ); ?></a></td>
						<td class="fort-st-num fort-st-wide<?php echo 'workouts' === $sort ? ' is-key' : ''; ?>"><?php echo esc_html( fort_st_n( $a['workouts'] ) ); ?></td>
						<td class="fort-st-num<?php echo 'pax_posts' === $sort ? ' is-key' : ''; ?>"><?php echo esc_html( fort_st_n( $a['pax_posts'] ) ); ?></td>
						<td class="fort-st-num<?php echo 'unique_pax' === $sort ? ' is-key' : ''; ?>"><?php echo esc_html( fort_st_n( $a['unique_pax'] ) ); ?></td>
						<td class="fort-st-num fort-st-wide<?php echo 'avg_pax' === $sort ? ' is-key' : ''; ?>"><?php echo null === $a['avg_pax'] ? '—' : esc_html( number_format_i18n( (float) $a['avg_pax'], 1 ) ); ?></td>
						<td class="fort-st-wide"><?php fort_st_spark( array_map( fn( $m ) => $months[ $a['ao_id'] ][ $m ] ?? 0, $last12 ), $last12 ); ?></td>
					</tr>
				<?php endforeach; ?>
			</tbody>
		</table>
	</div>
	<?php
}

/** A row of small bars (one per month). */
function fort_st_spark( array $values, array $labels ) {
	$max = max( 1, ...$values );
	echo '<span class="fort-st-spark" role="img" aria-label="' . esc_attr( implode( ', ', array_map( fn( $l, $v ) => fstats_month_label( $l ) . ' ' . $v, $labels, $values ) ) ) . '">';
	foreach ( $values as $i => $v ) {
		echo '<i style="height:' . esc_attr( (string) max( $v ? 8 : 2, fstats_pct( $v, $max ) ) ) . '%" title="' . esc_attr( fstats_month_label( $labels[ $i ] ) . ': ' . $v ) . '"></i>';
	}
	echo '</span>';
}

function fort_st_ao( $core, $d ) {
	$range = fort_st_arg( 'range', array_keys( FSTATS_RANGES ), 'ytd' );
	?>
	<div class="fort-st-grid">
		<section class="fort-st-block">
			<header class="fort-section__head fort-section__head--accent2"><h2 class="fort-h3"><?php esc_html_e( 'At a glance', 'fort' ); ?></h2></header>
			<div class="fort-st-table-wrap">
				<table class="fort-st-table fort-st-table--compact">
					<thead><tr><th></th><th class="fort-st-num"><?php esc_html_e( 'Workouts', 'fort' ); ?></th><th class="fort-st-num"><?php esc_html_e( 'Posts', 'fort' ); ?></th><th class="fort-st-num"><?php esc_html_e( 'Men', 'fort' ); ?></th><th class="fort-st-num"><?php esc_html_e( 'Avg', 'fort' ); ?></th></tr></thead>
					<tbody>
						<?php foreach ( FSTATS_RANGES as $w => $label ) : $r = $d['windows'][ $w ] ?? null; ?>
							<tr>
								<th scope="row"><?php echo esc_html( $label ); ?></th>
								<td class="fort-st-num"><?php echo $r ? esc_html( fort_st_n( $r['workouts'] ) ) : '—'; ?></td>
								<td class="fort-st-num"><?php echo $r ? esc_html( fort_st_n( $r['pax_posts'] ) ) : '—'; ?></td>
								<td class="fort-st-num"><?php echo $r ? esc_html( fort_st_n( $r['unique_pax'] ) ) : '—'; ?></td>
								<td class="fort-st-num"><?php echo $r && null !== $r['avg_pax'] ? esc_html( number_format_i18n( (float) $r['avg_pax'], 1 ) ) : '—'; ?></td>
							</tr>
						<?php endforeach; ?>
					</tbody>
				</table>
			</div>
			<?php if ( $d['no_q'] ) : ?>
				<p class="fort-st-callout">
					<span class="fort-label"><?php esc_html_e( 'Most posts without a Q this year', 'fort' ); ?></span>
					<?php echo fort_st_pax_link( $d['no_q']['user_id'], $d['no_q']['f3_name'] ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
					<span class="fort-dim"><?php /* translators: %s: number */ echo esc_html( sprintf( _n( '%s post', '%s posts', (int) $d['no_q']['posts'], 'fort' ), fort_st_n( $d['no_q']['posts'] ) ) ); ?></span>
				</p>
			<?php endif; ?>
			<p><a class="fort-more" href="<?php echo esc_url( fort_backblasts_url( array( 'ao' => $d['ao_name'] ) ) ); ?>"><?php /* translators: %s: AO */ echo esc_html( sprintf( __( 'Backblasts from %s →', 'fort' ), $d['ao_name'] ) ); ?></a></p>
		</section>
		<section class="fort-st-block">
			<header class="fort-section__head fort-section__head--accent2"><h2 class="fort-h3"><?php esc_html_e( 'Posts by month', 'fort' ); ?></h2></header>
			<?php fort_st_cols( array_map( fn( $m, $v ) => array( gmdate( 'M', strtotime( $m . '-01 UTC' ) ), $v, fstats_month_label( $m ) . ': ' . $v ), array_keys( $d['months'] ), $d['months'] ) ); ?>
		</section>
	</div>
	<section class="fort-st-block">
		<header class="fort-section__head fort-section__head--amber">
			<h2 class="fort-h3"><?php esc_html_e( 'Regulars', 'fort' ); ?></h2>
			<?php fort_st_chips( FSTATS_RANGES, $range, fn( $r ) => fort_stats_url( 'ao', $d['ao_id'], array( 'range' => 'ytd' === $r ? '' : $r ) ), __( 'Time range', 'fort' ) ); ?>
		</header>
		<?php fort_st_ranked( array_map( fn( $r ) => array( fort_st_pax_link( $r['user_id'], $r['f3_name'] ), $r['posts'], $r['qs'] ? sprintf( /* translators: %d: Qs */ _n( '%d Q', '%d Qs', (int) $r['qs'], 'fort' ), (int) $r['qs'] ) : '' ), $d['top'][ $range ] ?? array() ), __( 'posts', 'fort' ) ); ?>
	</section>
	<?php
}

// ── One PAX ───────────────────────────────────────────────────────────────────────────────

function fort_st_pax( $core, $d ) {
	fort_st_numbers(
		array(
			array( $d['total_posts'], __( 'posts', 'fort' ) ),
			array( $d['qs'], __( 'Qs', 'fort' ), 'amber' ),
			array( $d['coqs'], __( 'co-Qs', 'fort' ) ),
			array( $d['aos_visited'], __( 'AOs visited', 'fort' ) ),
			array( $d['current_streak'], __( 'week streak now', 'fort' ), 'accent2' ),
			array( $d['max_streak'], __( 'longest week streak', 'fort' ) ),
		)
	);
	?>
	<div class="fort-st-grid">
		<section class="fort-st-block">
			<header class="fort-section__head fort-section__head--accent2"><h2 class="fort-h3"><?php esc_html_e( 'Top AOs', 'fort' ); ?></h2></header>
			<?php fort_st_ranked( array_map( fn( $r ) => array( fort_st_ao_link( $core, $r['ao_name'] ), $r['posts'], $r['qs'] ? sprintf( /* translators: %d: Qs */ _n( '%d Q', '%d Qs', (int) $r['qs'], 'fort' ), (int) $r['qs'] ) : '' ), $d['top_aos'] ), __( 'posts', 'fort' ) ); ?>
		</section>
		<section class="fort-st-block">
			<header class="fort-section__head fort-section__head--amber"><h2 class="fort-h3"><?php esc_html_e( 'Standing', 'fort' ); ?></h2></header>
			<?php if ( $d['ranks'] ) : ?>
				<ul class="fort-st-ranks" aria-label="<?php esc_attr_e( 'Rank by posts', 'fort' ); ?>">
					<?php foreach ( FSTATS_RANGES as $w => $label ) : ?>
						<?php if ( isset( $d['ranks'][ $w ] ) ) : ?>
							<li><span class="fort-st-ranks__n"><?php echo esc_html( '#' . $d['ranks'][ $w ] ); ?></span><span class="fort-label"><?php echo esc_html( $label ); ?></span></li>
						<?php endif; ?>
					<?php endforeach; ?>
				</ul>
			<?php endif; ?>
			<p class="fort-dim"><?php /* translators: %d: months */ echo esc_html( sprintf( _n( 'Posted in %d month.', 'Posted in %d different months.', (int) $d['active_months'], 'fort' ), (int) $d['active_months'] ) ); ?></p>
			<?php
			$next = array_values( array_filter( FSTATS_MILESTONES, fn( $m ) => $m > (int) $d['total_posts'] ) )[0] ?? null;
			if ( $d['milestones'] || $next ) :
				?>
				<p class="fort-st-callout">
					<?php if ( $d['milestones'] ) : ?>
						<span class="fort-label"><?php esc_html_e( 'Milestone', 'fort' ); ?></span>
						<span class="fort-st-club"><?php /* translators: %d: posts */ echo esc_html( sprintf( __( '%d-post club', 'fort' ), end( $d['milestones'] ) ) ); ?></span>
					<?php endif; ?>
					<?php if ( $next ) : ?>
						<span class="fort-dim"><?php /* translators: 1: posts to go, 2: next milestone */ echo esc_html( sprintf( _n( '%1$s post to go to %2$s.', '%1$s posts to go to %2$s.', $next - (int) $d['total_posts'], 'fort' ), fort_st_n( $next - (int) $d['total_posts'] ), fort_st_n( $next ) ) ); ?></span>
					<?php endif; ?>
				</p>
			<?php endif; ?>
			<p><a class="fort-more" href="<?php echo esc_url( fort_backblasts_url( array( 'q' => $d['f3_name'] ) ) ); ?>"><?php /* translators: %s: name */ echo esc_html( sprintf( __( 'Backblasts mentioning %s →', 'fort' ), $d['f3_name'] ) ); ?></a></p>
		</section>
	</div>
	<?php
}

// ── Trends ────────────────────────────────────────────────────────────────────────────────

function fort_st_trends( $core ) {
	$months = array();
	foreach ( $core['monthly_trend'] ?? array() as $m ) {
		$months[ $m['month'] ] = $m;
	}
	$last12 = fstats_last_months( $core['today'], 12 );
	$label  = fn( $m ) => gmdate( 'M', strtotime( $m . '-01 UTC' ) );
	$weeks  = array_slice( $core['weekly_trend'] ?? array(), -26 );
	?>
	<section class="fort-st-block">
		<header class="fort-section__head fort-section__head--accent2">
			<h2 class="fort-h3"><?php esc_html_e( 'Posts by month', 'fort' ); ?></h2>
			<span class="fort-mono-dim"><?php esc_html_e( 'Every PAX post, last 12 months', 'fort' ); ?></span>
		</header>
		<?php fort_st_cols( array_map( fn( $m ) => array( $label( $m ), (int) ( $months[ $m ]['pax_posts'] ?? 0 ), fstats_month_label( $m ) . ': ' . fort_st_n( $months[ $m ]['pax_posts'] ?? 0 ) . ' posts, ' . fort_st_n( $months[ $m ]['unique_pax'] ?? 0 ) . ' men, ' . fort_st_n( $months[ $m ]['workouts'] ?? 0 ) . ' workouts' ), $last12 ) ); ?>
	</section>
	<div class="fort-st-grid">
		<section class="fort-st-block">
			<header class="fort-section__head fort-section__head--accent2">
				<h2 class="fort-h3"><?php esc_html_e( 'Different men each month', 'fort' ); ?></h2>
			</header>
			<?php fort_st_cols( array_map( fn( $m ) => array( $label( $m ), (int) ( $months[ $m ]['unique_pax'] ?? 0 ) ), $last12 ), true, 'accent2' ); ?>
		</section>
		<section class="fort-st-block">
			<header class="fort-section__head fort-section__head--amber">
				<h2 class="fort-h3"><?php esc_html_e( 'FNGs each month', 'fort' ); ?></h2>
			</header>
			<?php fort_st_cols( array_map( fn( $m ) => array( $label( $m ), (int) ( $months[ $m ]['fngs'] ?? 0 ) ), $last12 ), true, 'amber' ); ?>
		</section>
	</div>
	<section class="fort-st-block">
		<header class="fort-section__head fort-section__head--accent2">
			<h2 class="fort-h3"><?php esc_html_e( 'Posts by week', 'fort' ); ?></h2>
			<span class="fort-mono-dim"><?php esc_html_e( 'Last 26 weeks', 'fort' ); ?></span>
		</header>
		<?php
		// Each week by its Monday ('Oct 19'); every other label, so they fit.
		$monday = function ( $w ) {
			$d = new DateTime( 'now', new DateTimeZone( 'UTC' ) );
			$d->setISODate( (int) substr( $w, 0, 4 ), (int) substr( $w, -2 ) );
			return $d->format( 'M j' );
		};
		fort_st_cols( array_map( fn( $w, $i ) => array( ( count( $weeks ) - 1 - $i ) % 2 ? '' : ( count( $weeks ) - 1 === $i ? __( 'This wk', 'fort' ) : $monday( $w['week'] ) ), (int) $w['pax_posts'], sprintf( /* translators: 1: date, 2: posts, 3: workouts */ __( 'Week of %1$s: %2$s posts, %3$s workouts', 'fort' ), $monday( $w['week'] ), fort_st_n( $w['pax_posts'] ), fort_st_n( $w['workouts'] ) ) ), $weeks, array_keys( $weeks ) ), false );
		?>
	</section>
	<?php
}

// ── Streaks ───────────────────────────────────────────────────────────────────────────────

function fort_st_streaks( $core ) {
	$types = array();
	foreach ( $core['streak_types'] ?? array() as $t ) {
		$types[ $t['id'] ] = $t;
	}
	$type    = fort_st_arg( 'type', array_keys( $types ), 'weekly_posts' );
	$data    = fort_stats_streaks();
	$lists   = fstats_streak_lists( $data['streaks'][ $type ] ?? array(), fstats_names( $core['pax_stats'] ?? array() ) );
	$unit    = $types[ $type ]['unit'] ?? 'wks';
	$main    = array_filter( $types, fn( $t ) => ! str_starts_with( $t['id'], 'dow_' ) );
	$by_day  = array_filter( $types, fn( $t ) => str_starts_with( $t['id'], 'dow_' ) );
	$url     = fn( $t ) => fort_stats_url( 'streaks', null, array( 'type' => 'weekly_posts' === $t ? '' : $t ) );
	?>
	<div class="fort-st-toolbar">
		<?php fort_st_chips( array_map( fn( $t ) => $t['label'], $main ), $type, $url, __( 'Streak', 'fort' ) ); ?>
		<form class="fort-st-find" method="get" action="<?php echo esc_url( fort_stats_url( 'streaks' ) ); ?>">
			<label class="screen-reader-text" for="fort-st-type"><?php esc_html_e( 'By day of the week', 'fort' ); ?></label>
			<select id="fort-st-type" name="type" onchange="this.form.submit()">
				<option value=""><?php esc_html_e( 'By day of the week…', 'fort' ); ?></option>
				<?php foreach ( $by_day as $t ) : ?>
					<option value="<?php echo esc_attr( $t['id'] ); ?>"<?php selected( $t['id'], $type ); ?>><?php echo esc_html( $t['label'] ); ?></option>
				<?php endforeach; ?>
			</select>
			<noscript><button class="fort-btn" type="submit"><?php esc_html_e( 'Show', 'fort' ); ?></button></noscript>
		</form>
	</div>
	<p class="fort-st-note"><?php echo esc_html( ( $types[ $type ]['desc'] ?? '' ) . '.' ); ?></p>
	<?php if ( ! $data ) : ?>
		<p class="fort-notice"><?php esc_html_e( 'Streaks can’t be loaded right now. Check back in a few minutes.', 'fort' ); ?></p>
		<?php
		return;
	endif;
	?>
	<div class="fort-st-grid">
		<section class="fort-st-block">
			<header class="fort-section__head fort-section__head--accent2"><h2 class="fort-h3"><?php esc_html_e( 'Going now', 'fort' ); ?></h2></header>
			<?php fort_st_ranked( array_map( fn( $r ) => array( fort_st_pax_link( $r['user_id'], $r['f3_name'] ), $r['current_streak'] ), $lists['active'] ), $unit, 'accent2' ); ?>
		</section>
		<section class="fort-st-block">
			<header class="fort-section__head fort-section__head--amber"><h2 class="fort-h3"><?php esc_html_e( 'All-time longest', 'fort' ); ?></h2></header>
			<?php fort_st_ranked( array_map( fn( $r ) => array( fort_st_pax_link( $r['user_id'], $r['f3_name'] ), $r['max_streak'] ), $lists['record'] ), $unit, 'amber' ); ?>
		</section>
	</div>
	<?php
}

// ── FNGs ──────────────────────────────────────────────────────────────────────────────────

function fort_st_fngs( $core ) {
	$f = fort_stats_fng();
	if ( ! $f || empty( $f['total'] ) ) {
		echo '<p class="fort-notice">' . esc_html__( 'FNG numbers can’t be loaded right now.', 'fort' ) . '</p>';
		return;
	}
	$when = fort_st_arg( 'when', array( 'ytd', 'all' ), 'ytd' );
	$ytd  = 'ytd' === $when;
	fort_st_numbers(
		array(
			array( $f['ytd'], __( 'this year', 'fort' ), 'amber' ),
			array( $f['last90'], __( 'last 90 days', 'fort' ) ),
			array( $f['last30'], __( 'last 30 days', 'fort' ) ),
			array( $f['total'], __( 'all-time', 'fort' ) ),
		)
	);
	$monthly = array_slice( $f['monthly'] ?? array(), -12 );
	?>
	<section class="fort-st-block">
		<header class="fort-section__head fort-section__head--amber"><h2 class="fort-h3"><?php esc_html_e( 'FNGs by month', 'fort' ); ?></h2></header>
		<?php fort_st_cols( array_map( fn( $m ) => array( gmdate( 'M', strtotime( $m['month'] . '-01 UTC' ) ), (int) $m['count'], fstats_month_label( $m['month'] ) . ': ' . $m['count'] ), $monthly ), true, 'amber' ); ?>
	</section>
	<div class="fort-st-toolbar">
		<?php fort_st_chips( array( 'ytd' => __( 'This year', 'fort' ), 'all' => __( 'All-time', 'fort' ) ), $when, fn( $w ) => fort_stats_url( 'fngs', null, array( 'when' => 'ytd' === $w ? '' : $w ) ), __( 'Time range', 'fort' ) ); ?>
	</div>
	<div class="fort-st-grid">
		<section class="fort-st-block">
			<header class="fort-section__head fort-section__head--amber"><h2 class="fort-h3"><?php esc_html_e( 'Who EH’d them', 'fort' ); ?></h2></header>
			<?php fort_st_ranked( array_map( fn( $r ) => array( esc_html( $r['name'] ), $r['count'] ), array_slice( $f[ $ytd ? 'top_ehers_ytd' : 'top_ehers' ] ?? array(), 0, 15 ) ), __( 'FNGs', 'fort' ), 'amber' ); ?>
		</section>
		<section class="fort-st-block">
			<header class="fort-section__head fort-section__head--accent2"><h2 class="fort-h3"><?php esc_html_e( 'Where they posted', 'fort' ); ?></h2></header>
			<?php fort_st_ranked( array_map( fn( $r ) => array( fort_st_ao_link( $core, $r['ao'] ), $r['count'] ), array_slice( $f[ $ytd ? 'by_ao_ytd' : 'by_ao' ] ?? array(), 0, 15 ) ), __( 'FNGs', 'fort' ), 'accent2' ); ?>
		</section>
	</div>
	<section class="fort-st-block">
		<header class="fort-section__head fort-section__head--accent2"><h2 class="fort-h3"><?php esc_html_e( 'Latest FNGs', 'fort' ); ?></h2></header>
		<div class="fort-st-table-wrap">
			<table class="fort-st-table fort-st-table--compact">
				<thead><tr><th><?php esc_html_e( 'Date', 'fort' ); ?></th><th><?php esc_html_e( 'F3 name', 'fort' ); ?></th><th><?php esc_html_e( 'AO', 'fort' ); ?></th><th class="fort-st-wide"><?php esc_html_e( 'EH’d by', 'fort' ); ?></th></tr></thead>
				<tbody>
					<?php foreach ( $f['recent'] ?? array() as $r ) : ?>
						<tr>
							<td class="fort-mono-dim"><?php echo esc_html( fort_st_date( $r['date'] ) ); ?></td>
							<td><?php echo esc_html( $r['f3_name'] ?: '—' ); ?></td>
							<td><?php echo $r['ao'] ? fort_st_ao_link( $core, $r['ao'] ) : '—'; // phpcs:ignore WordPress.Security.EscapeOutput ?></td>
							<td class="fort-st-wide fort-dim"><?php echo esc_html( $r['eh'] ?: '—' ); ?></td>
						</tr>
					<?php endforeach; ?>
				</tbody>
			</table>
		</div>
	</section>
	<?php
}

// ── The FNG challenge ─────────────────────────────────────────────────────────────────────

function fort_st_fng_challenge( $ch ) {
	if ( ! $ch ) {
		echo '<p class="fort-notice">' . esc_html__( 'The FNG challenge board can’t be loaded right now.', 'fort' ) . '</p>';
		return;
	}
	fort_st_numbers(
		array(
			array( $ch['total_fngs'], __( 'FNGs', 'fort' ), 'amber' ),
			array( $ch['participating_aos'], __( 'AOs on the board', 'fort' ), 'accent2' ),
			array( $ch['total_aos'], __( 'AOs in the running', 'fort' ) ),
		)
	);
	$max   = max( 1, ...array_map( fn( $a ) => (int) $a['count'], $ch['aos'] ?: array( array( 'count' => 0 ) ) ) );
	$rank  = 0;
	$prev  = null;
	$zeros = array_values( array_filter( $ch['aos'], fn( $a ) => ! $a['count'] ) );
	$board = array_values( array_filter( $ch['aos'], fn( $a ) => $a['count'] ) );
	?>
	<div class="fort-st-grid fort-st-grid--wide">
		<section class="fort-st-block">
			<header class="fort-section__head fort-section__head--amber"><h2 class="fort-h3"><?php esc_html_e( 'The board', 'fort' ); ?></h2><span class="fort-mono-dim"><?php esc_html_e( 'Open an AO for names', 'fort' ); ?></span></header>
			<ol class="fort-st-board">
				<?php foreach ( $board as $i => $a ) : ?>
					<?php
					if ( $a['count'] !== $prev ) {
						$rank = $i + 1;
						$prev = $a['count'];
					}
					?>
					<li class="<?php echo $a['count'] ? '' : 'is-zero'; ?>">
						<?php if ( $a['fngs'] ) : ?>
							<details>
								<summary><?php fort_st_board_row( $a, $rank, $max ); ?></summary>
								<ul class="fort-st-board__names">
									<?php foreach ( $a['fngs'] as $n ) : ?>
										<li><span><?php echo esc_html( $n['f3_name'] ); ?></span><span class="fort-mono-dim"><?php echo esc_html( fort_st_date( $n['date'] ) . ( $n['eh'] ? ' · EH ' . $n['eh'] : '' ) ); ?></span></li>
									<?php endforeach; ?>
								</ul>
							</details>
						<?php else : ?>
							<div class="fort-st-board__plain"><?php fort_st_board_row( $a, 0, $max ); ?></div>
						<?php endif; ?>
					</li>
				<?php endforeach; ?>
			</ol>
			<?php if ( ! $board ) : ?>
				<p class="fort-dim fort-empty"><?php esc_html_e( 'No FNGs yet. The first one puts an AO on the board.', 'fort' ); ?></p>
			<?php endif; ?>
			<?php if ( $zeros ) : ?>
				<p class="fort-st-zeros"><span class="fort-label"><?php esc_html_e( 'Still at zero', 'fort' ); ?></span> <?php echo esc_html( implode( ' · ', array_column( $zeros, 'ao' ) ) ); ?></p>
			<?php endif; ?>
			<?php if ( $ch['unattributed'] ) : ?>
				<p class="fort-dim"><?php /* translators: %d: count */ echo esc_html( sprintf( _n( '%d FNG had no AO on the sign-up sheet.', '%d FNGs had no AO on the sign-up sheet.', (int) $ch['unattributed'], 'fort' ), (int) $ch['unattributed'] ) ); ?></p>
			<?php endif; ?>
		</section>
		<section class="fort-st-block">
			<header class="fort-section__head fort-section__head--accent2"><h2 class="fort-h3"><?php esc_html_e( 'Top EHers', 'fort' ); ?></h2></header>
			<?php fort_st_ranked( array_map( fn( $r ) => array( esc_html( $r['name'] ), $r['count'] ), $ch['top_ehers'] ?? array() ), __( 'FNGs', 'fort' ), 'accent2' ); ?>
		</section>
	</div>
	<?php
}

function fort_st_board_row( $a, $rank, $max ) {
	echo '<span class="fort-st-board__rank">' . ( $rank ? (int) $rank : '–' ) . '</span>'
		. '<span class="fort-st-board__ao">' . esc_html( $a['ao'] ) . '</span>'
		. fort_st_bar( fstats_pct( $a['count'], $max ), 'amber' ) // phpcs:ignore WordPress.Security.EscapeOutput
		. '<span class="fort-st-board__n">' . (int) $a['count'] . '</span>';
}
