<?php
/**
 * Stats pages for themes without their own fort-stats.php: the theme's header and footer around a
 * plain leaderboard. (The Fort theme lays out every stats view itself.)
 *
 * @package FortStats
 */

defined( 'ABSPATH' ) || exit;

$core = fort_stats_core();
get_header();
?>
<main id="main" style="max-width: 900px; margin: 0 auto; padding: 24px 16px 48px;">
	<h1><?php echo esc_html( fort_stats_title() ); ?></h1>
	<?php if ( ! $core ) : ?>
		<p><?php esc_html_e( 'Stats are unavailable right now. Check back in a few minutes.', 'fort-stats' ); ?></p>
	<?php else : ?>
		<table>
			<thead><tr><th>#</th><th><?php esc_html_e( 'Name', 'fort-stats' ); ?></th><th><?php esc_html_e( 'Posts (YTD)', 'fort-stats' ); ?></th><th><?php esc_html_e( 'Qs', 'fort-stats' ); ?></th></tr></thead>
			<tbody>
				<?php foreach ( array_slice( fstats_rank_rows( $core['leaderboards']['ytd'] ), 0, 100 ) as $r ) : ?>
					<tr><td><?php echo (int) $r['rank']; ?></td><td><?php echo esc_html( $r['f3_name'] ); ?></td><td><?php echo (int) $r['total_posts']; ?></td><td><?php echo (int) $r['qs']; ?></td></tr>
				<?php endforeach; ?>
			</tbody>
		</table>
	<?php endif; ?>
</main>
<?php
get_footer();
