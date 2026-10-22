<?php
/**
 * Tiny test runner for the plugin's pure functions (no WordPress needed):
 *
 *   docker run --rm -v "$PWD/wordpress-plugin/fort-stats":/p -w /p php:8.3.36-cli php tests/run.php
 *
 * Each tests/test-*.php file calls fortw_test( 'name', function () { ... } ) and the assert_*
 * helpers below. Exits non-zero if anything fails.
 */

define( 'FSTATS_TESTING', true );
define( 'ABSPATH', __DIR__ . '/' ); // Lets the includes load; nothing below calls WordPress.

$GLOBALS['fortw_tests'] = array();

function fortw_test( $name, $fn ) {
	$GLOBALS['fortw_tests'][] = array( $name, $fn );
}

function assert_same( $expected, $actual, $msg = '' ) {
	if ( $expected !== $actual ) {
		throw new Exception( ( $msg ? $msg . ': ' : '' ) . 'expected ' . var_export( $expected, true ) . ', got ' . var_export( $actual, true ) );
	}
}

function assert_true( $cond, $msg = 'expected true' ) {
	if ( ! $cond ) {
		throw new Exception( $msg );
	}
}

function assert_throws( $fn, $msg = 'expected an exception' ) {
	try {
		$fn();
	} catch ( Exception $e ) {
		return $e;
	}
	throw new Exception( $msg );
}

foreach ( glob( __DIR__ . '/../includes/pure/*.php' ) as $file ) {
	require_once $file;
}
foreach ( glob( __DIR__ . '/test-*.php' ) as $file ) {
	require $file;
}

$failed = 0;
foreach ( $GLOBALS['fortw_tests'] as list( $name, $fn ) ) {
	try {
		$fn();
		echo "ok   - $name\n";
	} catch ( Throwable $e ) {
		$failed++;
		echo "FAIL - $name\n       " . $e->getMessage() . "\n";
	}
}
$total = count( $GLOBALS['fortw_tests'] );
echo "\n" . ( $total - $failed ) . "/$total passed (PHP " . PHP_VERSION . ")\n";
exit( $failed ? 1 : 0 );
