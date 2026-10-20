<?php
/**
 * The Backblasts page (the page with slug "backblasts"): every posted workout's write-up, newest
 * first, from the stats API — searchable and filterable by AO, month and workout type, 24 a page.
 * Each card opens the full backblast (backblast.php). Anything written on the page shows above.
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.Security.NonceVerification.Recommended -- read-only filters in the URL
$filters = array(
	'q'     => isset( $_GET['q'] ) ? mb_substr( sanitize_text_field( wp_unslash( $_GET['q'] ) ), 0, 80 ) : '',
	'ao'    => isset( $_GET['ao'] ) ? mb_substr( sanitize_text_field( wp_unslash( $_GET['ao'] ) ), 0, 120 ) : '',
	'month' => isset( $_GET['month'] ) && preg_match( '/^\d{4}-\d{2}$/', wp_unslash( $_GET['month'] ) ) ? sanitize_text_field( wp_unslash( $_GET['month'] ) ) : '',
	'type'  => isset( $_GET['type'] ) ? mb_substr( sanitize_text_field( wp_unslash( $_GET['type'] ) ), 0, 60 ) : '',
);
$page_no = isset( $_GET['pg'] ) ? max( 1, (int) $_GET['pg'] ) : 1;
// phpcs:enable
$archive  = fort_backblast_archive( array_merge( $filters, array( 'page' => $page_no ) ) );
$choices  = $archive['choices'] ?? array( 'aos' => array(), 'months' => array(), 'types' => array() );
$filtered = (bool) array_filter( $filters );

get_header();
?>
<main id="main" class="fort-entry fort-bbs">
	<div class="fort-wrap">
		<?php while ( have_posts() ) : the_post(); ?>
			<header class="fort-entry__head">
				<span class="fort-kicker fort-accent2"><?php esc_html_e( 'From the gloom', 'fort' ); ?></span>
				<h1 class="fort-entry__title"><?php the_title(); ?></h1>
				<p class="fort-entry__dek"><?php esc_html_e( 'Every workout’s write-up, newest first — straight from the Q’s backblast.', 'fort' ); ?></p>
			</header>
			<?php if ( '' !== trim( get_the_content() ) ) : ?>
				<div class="fort-prose fort-schedule__notes"><?php the_content(); ?></div>
			<?php endif; ?>
		<?php endwhile; ?>

		<form class="fort-bbs__filters" method="get" action="<?php echo esc_url( get_permalink() ); ?>" role="search">
			<label class="screen-reader-text" for="bb-q"><?php esc_html_e( 'Search backblasts', 'fort' ); ?></label>
			<input id="bb-q" type="search" name="q" value="<?php echo esc_attr( $filters['q'] ); ?>" placeholder="<?php esc_attr_e( 'Search: a name, an exercise, a word…', 'fort' ); ?>">
			<label class="screen-reader-text" for="bb-ao"><?php esc_html_e( 'AO', 'fort' ); ?></label>
			<select id="bb-ao" name="ao">
				<option value=""><?php esc_html_e( 'All AOs', 'fort' ); ?></option>
				<?php foreach ( $choices['aos'] as $c ) : ?>
					<option value="<?php echo esc_attr( $c['name'] ); ?>" <?php selected( $filters['ao'], $c['name'] ); ?>><?php echo esc_html( $c['name'] ); ?></option>
				<?php endforeach; ?>
			</select>
			<label class="screen-reader-text" for="bb-month"><?php esc_html_e( 'Month', 'fort' ); ?></label>
			<select id="bb-month" name="month">
				<option value=""><?php esc_html_e( 'Any month', 'fort' ); ?></option>
				<?php foreach ( $choices['months'] as $c ) : ?>
					<option value="<?php echo esc_attr( $c['month'] ); ?>" <?php selected( $filters['month'], $c['month'] ); ?>><?php echo esc_html( gmdate( 'F Y', strtotime( $c['month'] . '-01 00:00:00 UTC' ) ) ); ?></option>
				<?php endforeach; ?>
			</select>
			<?php if ( $choices['types'] ) : ?>
				<label class="screen-reader-text" for="bb-type"><?php esc_html_e( 'Workout type', 'fort' ); ?></label>
				<select id="bb-type" name="type">
					<option value=""><?php esc_html_e( 'Any type', 'fort' ); ?></option>
					<?php foreach ( $choices['types'] as $c ) : ?>
						<option value="<?php echo esc_attr( $c['name'] ); ?>" <?php selected( $filters['type'], $c['name'] ); ?>><?php echo esc_html( $c['name'] ); ?></option>
					<?php endforeach; ?>
				</select>
			<?php endif; ?>
			<button class="fort-btn" type="submit"><?php esc_html_e( 'Show', 'fort' ); ?></button>
			<?php if ( $filtered ) : ?><a class="fort-more" href="<?php echo esc_url( get_permalink() ); ?>"><?php esc_html_e( 'Clear', 'fort' ); ?></a><?php endif; ?>
		</form>

		<?php if ( ! $archive ) : ?>
			<p class="fort-notice"><?php esc_html_e( 'The backblasts can’t be reached right now. Check back in a few minutes.', 'fort' ); ?></p>
		<?php else : ?>
			<p class="fort-dim fort-bbs__count">
				<?php
				$n = (int) $archive['total'];
				if ( '' !== $filters['q'] ) {
					/* translators: 1: number, 2: search words */
					echo esc_html( sprintf( _n( '%1$s backblast mentions “%2$s”', '%1$s backblasts mention “%2$s”', $n, 'fort' ), number_format_i18n( $n ), $filters['q'] ) );
				} else {
					/* translators: %s: number */
					echo esc_html( sprintf( _n( '%s backblast', '%s backblasts', $n, 'fort' ), number_format_i18n( $n ) ) );
				}
				?>
			</p>
			<?php if ( ! $archive['items'] ) : ?>
				<p class="fort-empty fort-dim"><?php esc_html_e( 'Nothing matches. Try fewer filters or a different word.', 'fort' ); ?></p>
			<?php else : ?>
				<div class="fort-bb-grid fort-bb-grid--wide">
					<?php foreach ( $archive['items'] as $b ) { fort_render_backblast( $b ); } ?>
				</div>
			<?php endif; ?>
			<?php if ( $archive['pages'] > 1 ) : $base = array_filter( $filters ); ?>
				<nav class="fort-pager" aria-label="<?php esc_attr_e( 'More backblasts', 'fort' ); ?>">
					<?php if ( $page_no > 1 ) : ?>
						<a class="fort-btn fort-btn--outline" href="<?php echo esc_url( add_query_arg( array_merge( $base, array( 'pg' => $page_no - 1 > 1 ? $page_no - 1 : null ) ), get_permalink() ) ); ?>"><?php esc_html_e( '← Newer', 'fort' ); ?></a>
					<?php endif; ?>
					<?php /* translators: 1: page, 2: pages */ ?>
					<span class="fort-mono-dim"><?php echo esc_html( sprintf( __( 'Page %1$d of %2$d', 'fort' ), $page_no, (int) $archive['pages'] ) ); ?></span>
					<?php if ( $page_no < $archive['pages'] ) : ?>
						<a class="fort-btn fort-btn--outline" href="<?php echo esc_url( add_query_arg( array_merge( $base, array( 'pg' => $page_no + 1 ) ), get_permalink() ) ); ?>"><?php esc_html_e( 'Older →', 'fort' ); ?></a>
					<?php endif; ?>
				</nav>
			<?php endif; ?>
		<?php endif; ?>
	</div>
</main>
<?php
get_footer();
