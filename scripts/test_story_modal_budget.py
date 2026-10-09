import datetime as dt
import unittest
from decimal import Decimal
from unittest.mock import Mock
from story_modal_budget import monthly_snapshot,h100_quote,observe

NOW=dt.datetime(2026,10,9,tzinfo=dt.timezone.utc)
RATES={"gpu_hour_cost_h100":"3.95","cpu_hour_cost":"0.0473","mem_gib_hour_cost":"0.008","egress_gib_cost":"0.04"}
class ModalBudgetTests(unittest.TestCase):
    def test_monthly_estimate_ignores_extra_grants_and_rounds_down(self):
        result=monthly_snapshot({"metered_cost":"26.10206004","billed_cost":"0","adjustments":{"credits":"-999"}},allowance_units=30_000_000,now=NOW)
        self.assertEqual(result["remaining_units"],3_897_939)
        self.assertEqual(result["renews_at"],"2026-11-01T00:00:00+00:00")
        self.assertTrue(result["billing_may_lag"])
    def test_period_expiry_and_zero_do_not_create_negative_capacity(self):
        now=dt.datetime(2026,12,31,23,59,59,tzinfo=dt.timezone.utc)
        result=monthly_snapshot({"metered_cost":"31","billed_cost":"1"},allowance_units=30_000_000,now=now)
        self.assertEqual(result["remaining_units"],0);self.assertEqual(result["valid_until"],"2027-01-01T00:00:00+00:00")
    def test_invalid_money_or_missing_rate_fails(self):
        for value in ("NaN","Infinity","-1",True):
            with self.assertRaises(ValueError): monthly_snapshot({"metered_cost":value,"billed_cost":0},allowance_units=30_000_000,now=NOW)
        with self.assertRaises(KeyError):h100_quote({})
        with self.assertRaises(ValueError):h100_quote({**RATES,"cpu_hour_cost":0})
    def test_all_resources_and_transport_fit_into_the_quote(self):
        q=h100_quote(RATES)
        self.assertGreater(q["per_shot_units"],3_400_000)
        self.assertLess(q["per_shot_units"],3_600_000)
        self.assertFalse(q["infrastructure_retry_ceiling_guaranteed"])
        self.assertTrue(q["requires_verified_zero_spend_limit"])
    def test_wrong_account_stops_before_billing_and_never_enables_wallet(self):
        ws=Mock();ws.name="other"
        with self.assertRaises(ValueError):observe({"provider_workspace":"expected","monthly_allowance_units":30_000_000},workspace=ws,now=NOW)
        ws.billing.summary.assert_not_called()
        ws.name="expected";ws.billing.summary.return_value={"metered_cost":Decimal("26.1"),"billed_cost":Decimal(0)};ws.billing.rates.return_value=RATES
        result=observe({"provider_workspace":"expected","monthly_allowance_units":30_000_000},workspace=ws,now=NOW)
        self.assertEqual(result["remaining_units"],3_900_000)
        self.assertNotIn("enabled",result)
if __name__=="__main__":unittest.main()
