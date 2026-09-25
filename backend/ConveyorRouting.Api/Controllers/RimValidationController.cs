using ConveyorRouting.Api.Interfaces.IServices;
using ConveyorRouting.Api.Models;
using Microsoft.AspNetCore.Mvc;

namespace ConveyorRouting.Api.Controllers
{
    /// <summary>Read side: WIP readiness, machine check, master-data gaps, barcode check, lookups.</summary>
    [Route("api")]
    public class RimValidationController : ApiControllerBase
    {
        private readonly IRimValidationService _service;

        public RimValidationController(IRimValidationService service)
        {
            _service = service;
        }

        [HttpGet("health")]
        public IActionResult Health() => Reply(_service.Health());

        [HttpGet("config")]
        public IActionResult Config() => Reply(_service.Config());

        /// <summary>One row per WIP material: can it be routed to a DBM with its running rim?</summary>
        [HttpGet("wip/readiness")]
        public IActionResult WipReadiness([FromQuery] WipFilter f) => Reply(_service.WipReadiness(f));

        /// <summary>WIP tires per rim size vs. machines running it.</summary>
        [HttpGet("wip/demand")]
        public IActionResult WipDemand([FromQuery] WipFilter f) => Reply(_service.WipDemand(f));

        /// <summary>One row per machine: is its running rim right for the WIP? Suggests changeovers.</summary>
        [HttpGet("wip/machines")]
        public IActionResult WipMachines([FromQuery] WipFilter f) => Reply(_service.WipMachines(f));

        [HttpGet("gaps")]
        public IActionResult Gaps([FromQuery] int hours = 48, [FromQuery] int? area_id = null) =>
            Reply(_service.Gaps(hours, area_id));

        [HttpGet("areas")]
        public IActionResult Areas() => Reply(_service.Areas());

        [HttpGet("running-sizes")]
        public IActionResult RunningSizes([FromQuery] int? area_id = null, [FromQuery] int hours = 48) =>
            Reply(_service.RunningSizes(area_id, hours));

        [HttpGet("dbm-machines")]
        public IActionResult DbmMachines([FromQuery] int days = 30) => Reply(_service.DbmMachines(days));

        [HttpGet("rims")]
        public IActionResult Rims() => Reply(_service.Rims());

        /// <summary>master.equipment_master: machine id (local_equipment_id), name and area.</summary>
        [HttpGet("equipment")]
        public IActionResult Equipment() => Reply(_service.Equipment());

        [HttpGet("material/{material_id:int}")]
        public IActionResult Material(int material_id) => Reply(_service.MaterialMapping(material_id));

        [HttpGet("audit")]
        public IActionResult Audit([FromQuery] int limit = 100) => Reply(_service.Audit(limit));

        [HttpGet("barcode/{barcode}")]
        public IActionResult Barcode(string barcode, [FromQuery] int? equipment_id = null,
                                     [FromQuery] int? area_id = null, [FromQuery] string ok_quality = null) =>
            Reply(_service.Barcode(barcode, equipment_id, area_id, ok_quality));
    }
}
