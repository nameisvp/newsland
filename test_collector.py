import unittest
from server import assess_story, group, timestamp, clean
class CollectorTests(unittest.TestCase):
    def story(self,title,source='A'):
        return {'title':title,'region':'India','score':4,'published':1,'sources':[{'name':source,'url':'https://example.com/'+source}]}
    def test_duplicate_group(self):
        items=group([self.story('RBI keeps repo rate unchanged at 5.5%'),self.story('RBI keeps repo rate unchanged at 5.5%','B')])
        self.assertEqual(len(items),1);self.assertEqual(len(items[0]['sources']),2)
    def test_numeric_changes_stay_separate(self):
        self.assertEqual(len(group([self.story('RBI repo rate 5.5%'),self.story('RBI repo rate 5.0%')])),2)
    def test_invalid_date_not_assumed_fresh(self):
        self.assertIsNone(timestamp('unknown'))
    def test_timezone_dates(self):
        self.assertEqual(timestamp('2026-10-05T10:00:00+05:30'),timestamp('Mon, 05 Oct 2026 04:30:00 GMT'))
    def test_markup_removed(self):
        self.assertEqual(clean('<b>RBI</b> &amp; banks'), 'RBI & banks')
    def test_material_rbi_decision_is_high_priority(self):
        item = assess_story('RBI keeps repo rate unchanged', 'India', official=True)
        self.assertEqual(item['tier'], 'Must know')
        self.assertIn('Monetary policy', item['matched'])
    def test_india_linked_global_macro_data_is_watchlisted(self):
        item = assess_story('US jobs data falls, dollar weakens against rupee', 'Global')
        self.assertEqual(item['tier'], 'Must know')
        self.assertIn('Economic data', item['matched'])
        self.assertIn('Market flows', item['matched'])
    def test_specific_company_results_are_watch_level(self):
        item = assess_story('HDFC Bank quarterly results show profit rises 12%', 'India')
        self.assertEqual(item['tier'], 'Watch')
        self.assertIn('Earnings', item['matched'])
    def test_non_market_entertainment_is_lower_signal(self):
        item = assess_story('The Paradise box office collection day 11: film gains momentum', 'India')
        self.assertEqual(item['tier'], 'More')
        self.assertEqual(item['score'], 0)
    def test_generic_non_market_headline_is_not_promoted(self):
        item = assess_story('India economy strong; energy security, jobs key to growth', 'India')
        self.assertEqual(item['tier'], 'More')
    def test_peripheral_european_data_is_not_a_top_india_driver(self):
        item = assess_story('Italy services growth slows in September as costs rise, PMI shows', 'Global')
        self.assertEqual(item['tier'], 'More')
    def test_large_global_company_results_remain_visible(self):
        item = assess_story('Accenture results beat estimates as revenue rises', 'Global')
        self.assertEqual(item['tier'], 'Watch')
    def test_indian_it_sector_impact_from_accenture_remains_visible(self):
        item = assess_story("Accenture's growth beat sparks rally, but outlook for Indian IT is mixed", 'India')
        self.assertEqual(item['tier'], 'Watch')
    def test_unrelated_overseas_single_stock_move_stays_lower_signal(self):
        item = assess_story('Ithaca Energy shares rise 3% on Canadian asset deal', 'Global')
        self.assertEqual(item['tier'], 'More')
    def test_india_share_price_shock_is_retained_as_a_driver(self):
        item = assess_story('ESDS Software shares hit lower circuit, crash nearly 30%', 'India')
        self.assertEqual(item['tier'], 'Watch')
        self.assertEqual(item['category'], 'Company move')
    def test_material_indian_order_is_retained(self):
        item = assess_story('L&T wins ₹10,000 crore orders for power transmission business', 'India')
        self.assertEqual(item['tier'], 'Watch')
        self.assertEqual(item['category'], 'Company move')
    def test_india_trade_policy_news_is_retained(self):
        item = assess_story('US-India trade deal negotiations reach a plateau', 'Global')
        self.assertEqual(item['tier'], 'Watch')
    def test_airline_fuel_charge_change_is_retained(self):
        item = assess_story('IndiGo revises fuel charges as ATF prices rise', 'India')
        self.assertEqual(item['tier'], 'Watch')
        self.assertEqual(item['category'], 'Sector & corporate news')
    def test_official_source_adds_only_a_small_confidence_boost(self):
        official = assess_story('RBI keeps repo rate unchanged', 'India', official=True)
        other = assess_story('RBI keeps repo rate unchanged', 'India', official=False)
        self.assertEqual(official['score'] - other['score'], 1)
if __name__=='__main__': unittest.main()

class BriefEvidenceTests(unittest.TestCase):
    def test_partial_flow_offset(self):
        from server import flow_context
        text = flow_context({'fii_net_cr': -2846, 'dii_net_cr': 2135})
        self.assertIn('selling ₹711', text)
        self.assertIn('partially offsets', text)

    def test_crossed_resistance_not_overhead(self):
        from server import pivot_context
        text = pivot_context(22520, {'pivot': 22337, 'r1': 22494, 'r2': 22756})
        self.assertIn('22,756', text)
        self.assertNotIn('resistance above this reading: 22,494', text)

    def test_oil_decline_context(self):
        from server import synthesize_why_it_matters, get_impact_chain
        title = 'Wall Street heads for weekly gains as tech shares rebound, oil prices retreat'
        self.assertIn('Falling crude', synthesize_why_it_matters(title, 'Energy & geopolitics', {'CRUDE'}))
        self.assertEqual(get_impact_chain(title, 'Energy & geopolitics', {'CRUDE'})['rule'], 'CRUDE_DROP')

    def test_rate_cut_bet_is_not_hike(self):
        from server import get_impact_chain
        self.assertIsNone(get_impact_chain('Gold may draw support from decline in Oct Fed rate hike bet', 'Monetary policy', {'FED'}))

    def test_unknown_oil_direction_has_no_mapping(self):
        from server import get_impact_chain
        self.assertIsNone(get_impact_chain('Brent oil outlook in focus', 'Energy & geopolitics', {'CRUDE'}))

    def test_cook_hearing_group(self):
        from server import should_cluster
        self.assertTrue(should_cluster({'title': 'Trump to hold inquiry into Fed’s Lisa Cook at White House', 'published': 1}, {'title': 'Trump orders Nov. 5 Cook hearing in renewed bid to oust Fed governor Lisa Cook', 'published': 1}))
