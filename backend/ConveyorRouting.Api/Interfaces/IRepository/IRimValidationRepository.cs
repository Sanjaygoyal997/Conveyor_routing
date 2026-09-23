using System.Collections.Generic;
using ConveyorRouting.Api.Models;

namespace ConveyorRouting.Api.Interfaces.IRepository
{
    public interface IRimValidationRepository
    {
        Dictionary<string, object> Health();
        List<Dictionary<string, object>> WipReadiness(WipFilter f);
        List<Dictionary<string, object>> WipDemand(WipFilter f);
        List<Dictionary<string, object>> WipMachines(WipFilter f);
        List<Dictionary<string, object>> Gaps(int hours, int? areaId);
        List<Dictionary<string, object>> Areas();
        List<Dictionary<string, object>> RunningSizes(int? areaId, int hours);
        List<Dictionary<string, object>> DbmMachines(int days);
        List<Dictionary<string, object>> Rims();
        List<Dictionary<string, object>> MaterialMapping(int materialId);
        List<Dictionary<string, object>> Audit(int limit);
        Dictionary<string, object> Barcode(string barcode, int? equipmentId, int? areaId, string okQuality);
    }
}
