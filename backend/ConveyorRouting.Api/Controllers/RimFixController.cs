using ConveyorRouting.Api.Interfaces.IServices;
using ConveyorRouting.Api.Models;
using Microsoft.AspNetCore.Mvc;

namespace ConveyorRouting.Api.Controllers
{
    /// <summary>Master-data fixes (see RimFixService for the write guard).</summary>
    [Route("api/fix")]
    public class RimFixController : ApiControllerBase
    {
        private readonly IRimFixService _service;

        public RimFixController(IRimFixService service)
        {
            _service = service;
        }

        /// <summary>Map an active rim to a material (a material may accept several rims).</summary>
        [HttpPost("material-rim")]
        public IActionResult AddMaterialRim([FromBody] MaterialRimIn body,
            [FromHeader(Name = "X-User")] string user, [FromHeader(Name = "X-Admin-Token")] string token) =>
            Reply(_service.AddMaterialRim(body, user, token));

        /// <summary>Remove duplicate rows of one material/area/rim, keeping the oldest.</summary>
        [HttpPost("material-rim/dedupe")]
        public IActionResult Dedupe([FromBody] DedupeIn body,
            [FromHeader(Name = "X-User")] string user, [FromHeader(Name = "X-Admin-Token")] string token) =>
            Reply(_service.DedupeMaterialRim(body, user, token));

        [HttpDelete("material-rim/{id:int}")]
        public IActionResult RemoveMaterialRim(int id,
            [FromHeader(Name = "X-User")] string user, [FromHeader(Name = "X-Admin-Token")] string token) =>
            Reply(_service.RemoveMaterialRim(id, user, token));

        [HttpPatch("material-rim/{id:int}")]
        public IActionResult SetArea(int id, [FromBody] AreaIn body,
            [FromHeader(Name = "X-User")] string user, [FromHeader(Name = "X-Admin-Token")] string token) =>
            Reply(_service.SetMaterialRimArea(id, body, user, token));

        [HttpPut("material-rim/{id:int}/rim")]
        public IActionResult ChangeRim(int id, [FromBody] RimIn body,
            [FromHeader(Name = "X-User")] string user, [FromHeader(Name = "X-Admin-Token")] string token) =>
            Reply(_service.ChangeMaterialRim(id, body, user, token));

        /// <summary>Set (or create) the running rim of an equipment, i.e. record a changeover.</summary>
        [HttpPut("running/{equipment_id:int}")]
        public IActionResult SetRunningRim(int equipment_id, [FromBody] RimIn body,
            [FromHeader(Name = "X-User")] string user, [FromHeader(Name = "X-Admin-Token")] string token) =>
            Reply(_service.SetRunningRim(equipment_id, body, user, token));

        [HttpPost("rim/{rim_id:int}/activate")]
        public IActionResult ActivateRim(int rim_id,
            [FromHeader(Name = "X-User")] string user, [FromHeader(Name = "X-Admin-Token")] string token) =>
            Reply(_service.ActivateRim(rim_id, user, token));
    }
}
