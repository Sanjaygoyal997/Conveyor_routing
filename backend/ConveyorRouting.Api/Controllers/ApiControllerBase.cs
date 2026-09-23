using ConveyorRouting.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;

namespace ConveyorRouting.Api.Controllers
{
    /// <summary>JWT (when RimValidation:RequireJwt) + CORS like SmartMES_ReportAPI; OEMResponse with its status code.</summary>
    [EnableCors("AllowOrigin")]
    [Authorize(Policy = Startup.ApiPolicy)]
    [ApiController]
    public abstract class ApiControllerBase : ControllerBase
    {
        protected IActionResult Reply(OEMResponse response) => StatusCode(response.StatusCode, response);
    }
}
